/**
 * Reading salary cells out of a Google Sheets CSV export.
 *
 * This is the bug that made the parity gate report "31 differences with
 * identical row counts". The export serialises what a cell DISPLAYS, so a cell
 * holding 42000 in the Portuguese locale arrives as "42 000,00". Code.gs's
 * parseSalary strips spaces and commas without understanding either, turning it
 * into 4 200 000 — a hundredfold error on 17 of the 604 Portugal rows.
 *
 * Production was never affected: Apps Script reads the Sheet through
 * getValues(), which returns the underlying number. Only the export path was
 * broken, and those phantom millions were reported to the user as corrupt data
 * before the cause was found.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseSalaryFromExport, parseSalaryLegacy } from './lib/sheet-import.mjs';

test('European formatting is read at its true magnitude', () => {
  // Every one of these is a real cell from the Historical export.
  assert.equal(parseSalaryFromExport('42 000,00'), 42000);
  assert.equal(parseSalaryFromExport('55 000,00'), 55000);
  assert.equal(parseSalaryFromExport('15 500,00'), 15500);
  assert.equal(parseSalaryFromExport('130 000,00'), 130000);
  assert.equal(parseSalaryFromExport('32 200,00'), 32200);
});

test('the legacy reader is the one that inflates them, by exactly 100x', () => {
  // Kept as a regression witness: this is what the gate was comparing against.
  assert.equal(parseSalaryLegacy('42 000,00'), 4200000);
  assert.equal(parseSalaryFromExport('42 000,00') * 100, parseSalaryLegacy('42 000,00'));
});

test('plain thousands separators still work', () => {
  assert.equal(parseSalaryFromExport('54 000'), 54000);
  assert.equal(parseSalaryFromExport('29 554'), 29554);
  assert.equal(parseSalaryFromExport('55,000'), 55000, 'anglo grouping comma');
  assert.equal(parseSalaryFromExport('55 000'), 55000, 'non-breaking space');
});

test('bare numbers are unchanged', () => {
  assert.equal(parseSalaryFromExport('62000'), 62000);
  assert.equal(parseSalaryFromExport(62000), 62000);
  // Left alone on purpose: whether "18" means 18 000 is a product decision
  // (decision B), not a parsing one.
  assert.equal(parseSalaryFromExport('18'), 18);
});

test('dot-style decimals are dropped, not multiplied', () => {
  assert.equal(parseSalaryFromExport('42000.00'), 42000);
  assert.equal(parseSalaryFromExport('42000.5'), 42000);
});

test('empty and unparseable cells read as zero', () => {
  assert.equal(parseSalaryFromExport(''), 0);
  assert.equal(parseSalaryFromExport(null), 0);
  assert.equal(parseSalaryFromExport(undefined), 0);
  assert.equal(parseSalaryFromExport('n/a'), 0);
  assert.equal(parseSalaryFromExport('   '), 0);
});

test('a three-digit group after the separator is thousands, not decimals', () => {
  // The decimal rule only fires on one or two trailing digits, so "1 234,567"
  // cannot be mistaken for 1 234 — that shape is grouping, not a price.
  assert.equal(parseSalaryFromExport('1 234,567'), 1234567);
  assert.equal(parseSalaryFromExport('42 000,00'), 42000, 'while two digits are decimals');
});
