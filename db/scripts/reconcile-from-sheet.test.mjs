/**
 * reconcile-from-sheet.mjs — the plan. It writes to the live database, so what
 * it must NOT touch matters as much as what it fills in.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planReconcile } from './reconcile-from-sheet.mjs';

const sub = (legacy_id, created_at, o = {}) => ({ legacy_id, created_at, role: 'PM', base: 50000, total: null, yoe: 4,
  district: 'Porto', perception: 50, full_survey: false, survey: {}, ...o });
const email = (sid, ts, addr, source = 'email_gate') => [sid, ts, addr, source, 'TRUE', 'FALSE', '40', 'tok'];
const SINCE = '2026-09-22T14:24:15Z';

test('a comparison the mirror dropped is planned for insert; one already there is not', () => {
  const plan = planReconcile({
    sheetSubs: [sub('sid-have', '2026-09-01'), sub('sid-lost', '2026-09-23T09:02:42Z')],
    emailRows: [], supaSubs: [{ legacy_id: 'sid-have', full_survey: false }], supaContacts: [], since: SINCE
  });
  assert.deepEqual(plan.inserts.map((r) => r.legacy_id), ['sid-lost']);
});

test('a survey completed in the Sheet but not here is copied; excluded test rows never are', () => {
  const plan = planReconcile({
    sheetSubs: [sub('sid-b', '2026-05-01', { full_survey: true, survey: { Gender: 'Female' } }),
      sub('sid-test', '2026-09-23T11:13Z', { full_survey: true })],
    emailRows: [email('sid-test', '2026-09-23T11:13:22Z', 't@x.co')],
    supaSubs: [{ legacy_id: 'sid-b', full_survey: false }],
    supaContacts: [], since: SINCE, exclude: ['sid-test']
  });
  assert.deepEqual(plan.surveys.map((r) => r.legacy_id), ['sid-b']);
  assert.equal(plan.inserts.length, 0, 'the excluded test row is not inserted');
  assert.equal(plan.contacts.length, 0, 'nor is its contact');
});

test('only the first row with a shared id can carry the survey, as in the Sheet', () => {
  const plan = planReconcile({
    sheetSubs: [sub('sid-1', '2026-09-01T10:00Z', { full_survey: true }), sub('sid-1', '2026-09-01T10:01Z')],
    emailRows: [], supaSubs: [{ legacy_id: 'sid-1', full_survey: false }], supaContacts: [], since: SINCE
  });
  assert.equal(plan.surveys.length, 1);
  assert.equal(plan.surveys[0].created_at, '2026-09-01T10:00Z');
});

test('contacts: only missing ones since dual-write, once per email and source', () => {
  const plan = planReconcile({
    sheetSubs: [], supaSubs: [],
    emailRows: [
      email('sid-old', '2026-08-01T10:00Z', 'old@x.co'),                  // before dual-write: never imported, left alone
      email('sid-a', '2026-09-23T09:02:52Z', 'A@X.co'),                   // missing → insert
      email('sid-a', '2026-09-23T09:03:10Z', 'a@x.co'),                   // same email+source → once
      email('sid-c', '2026-09-23T08:04:16Z', 'c@x.co', 'survey_inline')   // already here
    ],
    supaContacts: [{ email: 'c@x.co', source: 'survey_inline' }], since: SINCE
  });
  assert.deepEqual(plan.contacts.map((c) => `${c.email}|${c.source}`), ['a@x.co|email_gate']);
  assert.equal(plan.contacts[0].report_optin, true);
  assert.equal(plan.contacts[0].percentile, 40);
});
