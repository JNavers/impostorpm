/**
 * The importer is the one piece that cannot be tested against real data here,
 * so it is tested against CSV that reproduces the exports' exact shape:
 * setupSubmissionsHeaders()'s 44 columns, and the Historical tab's long Google
 * Form question texts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCsv, mapSubmissions, mapHistorical, parseSalaryLegacy } from './lib/sheet-import.mjs';

const SUBMISSION_HEADER = [
  'ID', 'Timestamp', 'Base Salary', 'Total Comp', 'Role', 'YoE', 'City',
  'Perception Guess', 'Gender', 'Company', 'Industry', 'Org Size',
  'Company Type', 'Remote Policy', 'Company Location', 'Employment', 'Perks',
  'Transparency', 'Salary Adequacy', 'Negotiation Comfort', 'Full Survey',
  'Dashboard Token', 'Bonus', 'Equity Grant', 'Full Survey Total Comp',
  'Currency', 'Has Equity', 'Perks Value', 'Seniority', 'Years Current Role',
  'Top Skills', '_reserved', 'Company Type Other', 'Industry Other',
  'Hybrid Days', 'Hybrid Days Frequency', 'Company Location Other',
  'Office In Country', 'Employment Other', 'Perk Wellness', 'Perk Home Office',
  'Perk Learning', 'Perk Meal', 'Perk Pension'
].join(',');

function submissionRow(overrides = {}) {
  const cells = new Array(44).fill('');
  cells[0] = overrides.id ?? 'abc-123-def-456';
  cells[1] = overrides.ts ?? '2026-06-01T10:00:00.000Z';
  cells[2] = overrides.base ?? '55000';
  cells[3] = overrides.total ?? '62000';
  cells[4] = overrides.role ?? 'Senior PM';
  cells[5] = overrides.yoe ?? '6';
  cells[6] = overrides.city ?? 'Porto';
  cells[7] = overrides.perception ?? '40';
  cells[8] = overrides.gender ?? 'Male';
  cells[10] = overrides.industry ?? 'SaaS';
  cells[20] = overrides.fullSurvey ?? 'Yes';
  return cells.join(',');
}

test('CSV parser handles quotes, embedded commas and newlines', () => {
  const rows = parseCsv('a,b,c\n1,"two, and a half","line\nbreak"\n');
  assert.deepEqual(rows[0], ['a', 'b', 'c']);
  assert.deepEqual(rows[1], ['1', 'two, and a half', 'line\nbreak']);
});

test('CSV parser strips the BOM Google Sheets exports', () => {
  const rows = parseCsv('﻿ID,Timestamp\nx,y\n');
  assert.equal(rows[0][0], 'ID', 'a BOM left in place would break the header check');
});

test('CSV parser unescapes doubled quotes', () => {
  assert.deepEqual(parseCsv('a\n"he said ""hi"""\n')[1], ['he said "hi"']);
});

test('submissions map to typed fields plus a survey blob', () => {
  const { rows, problems } = mapSubmissions(parseCsv(`${SUBMISSION_HEADER}\n${submissionRow()}\n`));
  assert.deepEqual(problems, []);

  const r = rows[0];
  assert.equal(r.base, 55000);
  assert.equal(r.total, 62000);
  assert.equal(r.role, 'Senior PM');
  assert.equal(r.yoe, 6);
  assert.equal(r.district, 'Porto');
  assert.equal(r.full_survey, true);
  // Everything non-typed lands in `survey`, and empty cells are omitted so the
  // blob stays small and queryable rather than 35 empty strings per row.
  assert.equal(r.survey.Gender, 'Male');
  assert.equal(r.survey.Industry, 'SaaS');
  assert.equal('Company' in r.survey, false, 'empty cells must not be stored');
  assert.equal('Base Salary' in r.survey, false, 'typed columns must not be duplicated into survey');
});

test('a shifted submissions header is refused, not imported', () => {
  const shifted = SUBMISSION_HEADER.replace('Base Salary,Total Comp', 'Total Comp,Base Salary');
  const { problems } = mapSubmissions(parseCsv(`${shifted}\n${submissionRow()}\n`));
  assert.ok(problems.length >= 2, 'swapping two columns must be caught');
  assert.match(problems[0], /column 3/);
});

test('historical headers resolve through the tolerant matcher', () => {
  const header = [
    'Timestamp',
    'Where do you reside?',
    'What is your gross annual salary, before taxes, without perks?',
    'What is your gross annual salary, before taxes, with perks included?',
    'Role',
    'How many years of experience do you have in Product?',
    'Outlier'
  ].map((h) => `"${h}"`).join(',');

  const body = '"2024-01-01","Portugal","48000","52000","03-Senior Product Manager","6-8","FALSE"';
  const { rows, problems, col } = mapHistorical(parseCsv(`${header}\n${body}\n`));

  assert.deepEqual(problems, []);
  assert.equal(col.country, 1);
  assert.equal(col.base, 2);
  assert.equal(col.total, 3, 'the "with perks" column must not be mistaken for "without perks"');
  assert.equal(rows[0].base, 48000);
  assert.equal(rows[0].outlier, false);
});

test('an unresolvable historical header aborts instead of silently dropping a column', () => {
  const header = '"Timestamp","Country","Salary","Role","Years","Outlier"';
  const { problems } = mapHistorical(parseCsv(`${header}\n"x","Portugal","1","Role","1","FALSE"\n`));
  assert.ok(problems.length > 0);
  assert.match(problems.join(' '), /country|base|yoe/);
});

test('parseSalary reproduces the legacy parseInt behaviour, bug included', () => {
  assert.equal(parseSalaryLegacy('55 000'), 55000, 'spaces are stripped');
  assert.equal(parseSalaryLegacy('55,000'), 55000, 'thousands commas are stripped');
  assert.equal(parseSalaryLegacy('55 000'), 55000, 'non-breaking spaces are stripped');
  assert.equal(parseSalaryLegacy(''), 0);
  assert.equal(parseSalaryLegacy('n/a'), 0);
  // Documented, deliberate: Code.gs uses parseInt, so a European thousands DOT
  // truncates. Reproduced so the import matches the published benchmark; see
  // the finding in db/README.md before "fixing" it.
  assert.equal(parseSalaryLegacy('55.000'), 55, 'parseInt truncates at the dot — matches production');
});
