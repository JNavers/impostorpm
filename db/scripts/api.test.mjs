/**
 * The RPCs in db/sql/003_api.sql.
 *
 * These encode the behaviours the Sheet got wrong, so each test names the
 * Sheet behaviour it is replacing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestDb } from './lib/db.mjs';

async function newSubmission(db, overrides = {}) {
  const { rows } = await db.query(
    `insert into submissions (base_salary, total_comp, role, yoe, district)
     values ($1, $2, $3, $4, $5) returning id`,
    [overrides.base ?? 50000, overrides.total ?? null, overrides.role ?? 'PM',
     overrides.yoe ?? 4, overrides.district ?? 'Porto']
  );
  return rows[0].id;
}

const rpc = async (db, fn, args) => (await db.query(`select ${fn} as out`, args)).rows[0].out;

test('survey answers merge instead of overwriting', async () => {
  // The Sheet wrote each answer to its own cell, so a partial second pass only
  // touched the cells it had. A PostgREST PATCH on jsonb would have replaced
  // the whole blob and lost the first pass — this is why the RPC exists.
  const db = await createTestDb();
  const id = await newSubmission(db);

  await rpc(db, 'compass_update_survey($1, $2)', [id, JSON.stringify({ gender: 'Female', industry: 'SaaS' })]);
  const second = await rpc(db, 'compass_update_survey($1, $2)', [id, JSON.stringify({ perks: 'Health' })]);

  const { rows } = await db.query('select survey, full_survey, survey_at from submissions where id = $1', [id]);
  assert.equal(rows[0].survey.gender, 'Female', 'the first pass must survive the second');
  assert.equal(rows[0].survey.industry, 'SaaS');
  assert.equal(rows[0].survey.perks, 'Health');
  assert.equal(rows[0].full_survey, true);
  assert.equal(second.fields, 3);
  await db.close();
});

test('a later pass overwrites only the keys it supplies', async () => {
  const db = await createTestDb();
  const id = await newSubmission(db);
  await rpc(db, 'compass_update_survey($1, $2)', [id, JSON.stringify({ company: 'Old', gender: 'Male' })]);
  await rpc(db, 'compass_update_survey($1, $2)', [id, JSON.stringify({ company: 'New' })]);

  const { rows } = await db.query('select survey from submissions where id = $1', [id]);
  assert.equal(rows[0].survey.company, 'New');
  assert.equal(rows[0].survey.gender, 'Male');
  await db.close();
});

test('survey_at records the first completion, not the latest edit', async () => {
  const db = await createTestDb();
  const id = await newSubmission(db);
  await rpc(db, 'compass_update_survey($1, $2)', [id, JSON.stringify({ gender: 'Female' })]);
  const { rows: first } = await db.query('select survey_at from submissions where id = $1', [id]);
  await rpc(db, 'compass_update_survey($1, $2)', [id, JSON.stringify({ perks: 'Gym' })]);
  const { rows: second } = await db.query('select survey_at from submissions where id = $1', [id]);
  assert.deepEqual(first[0].survey_at, second[0].survey_at);
  await db.close();
});

test('updating an unknown submission reports not_found rather than throwing', async () => {
  const db = await createTestDb();
  const out = await rpc(db, 'compass_update_survey($1, $2)',
    ['00000000-0000-4000-8000-000000000000', JSON.stringify({ gender: 'Female' })]);
  assert.equal(out.status, 'not_found');
  await db.close();
});

test('a repeat capture is idempotent and keeps the original token', async () => {
  // The Sheet appended a second row, so the same person counted twice and got
  // a second welcome email with a different token — while the token in the
  // first email stayed live. Both are fixed by the unique index + upsert.
  const db = await createTestDb();

  const first = await rpc(db, 'compass_record_contact($1, $2)', ['A@Example.com ', 'email_gate']);
  const second = await rpc(db, 'compass_record_contact($1, $2)', ['a@example.com', 'email_gate']);

  assert.equal(first.created, true);
  assert.equal(second.created, false, 'the caller must be able to tell a repeat from a first capture');
  assert.equal(first.token, second.token, 'a token already sent by email must keep working');

  const { rows } = await db.query('select count(*)::int c, email from contacts group by email');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].c, 1, 'one person, one row');
  assert.equal(rows[0].email, 'a@example.com', 'emails are normalised on the way in');
  await db.close();
});

test('the same email from a different source is a separate contact', async () => {
  const db = await createTestDb();
  await rpc(db, 'compass_record_contact($1, $2)', ['a@example.com', 'email_gate']);
  const other = await rpc(db, 'compass_record_contact($1, $2)', ['a@example.com', 'newsletter_popup']);
  assert.equal(other.created, true, 'source is part of the identity: it is how the funnel is measured');
  await db.close();
});

test('opt-ins only ever ratchet up', async () => {
  const db = await createTestDb();
  await rpc(db, 'compass_record_contact($1, $2, null, $3, $4)',
    ['a@example.com', 'email_gate', true, true]);
  await rpc(db, 'compass_record_contact($1, $2, null, $3, $4)',
    ['a@example.com', 'email_gate', false, false]);

  const { rows } = await db.query('select report_optin, newsletter_optin from contacts');
  assert.equal(rows[0].report_optin, true, 'a later form must not silently withdraw consent');
  assert.equal(rows[0].newsletter_optin, true);
  await db.close();
});

test('email_log records every attempt and stamps the contact', async () => {
  const db = await createTestDb();
  const c = await rpc(db, 'compass_record_contact($1, $2)', ['a@example.com', 'email_gate']);

  await db.query('select compass_log_email($1, $2, $3, $4, $5)', [c.id, 'capture', false, null, 'Resend 429']);
  await db.query('select compass_log_email($1, $2, $3, $4, $5)', [c.id, 'capture', true, 're_123', null]);

  const { rows } = await db.query('select ok, error, resend_id from email_log order by id');
  assert.equal(rows.length, 2, 'the failed attempt must survive the retry — the Sheet overwrote it');
  assert.equal(rows[0].ok, false);
  assert.equal(rows[1].resend_id, 're_123');

  await db.query('select compass_log_email($1, $2, $3, null, null)', [c.id, 'reminder_1', true]);
  const { rows: stamped } = await db.query('select reminder_1_at, result_email_at from contacts');
  assert.ok(stamped[0].reminder_1_at, 'a successful reminder stamps the contact');
  assert.equal(stamped[0].result_email_at, null, 'and touches nothing else');
  await db.close();
});

test('a failed send does not stamp the contact', async () => {
  const db = await createTestDb();
  const c = await rpc(db, 'compass_record_contact($1, $2)', ['a@example.com', 'email_gate']);
  await db.query('select compass_log_email($1, $2, $3, null, $4)', [c.id, 'reminder_1', false, 'bounced']);
  const { rows } = await db.query('select reminder_1_at from contacts');
  assert.equal(rows[0].reminder_1_at, null, 'otherwise the retry would never happen');
  await db.close();
});

test('the reminder queue matches survey-reminders.gs', async () => {
  const db = await createTestDb();

  // Opted in, no survey, 25h old → due for reminder 1.
  const due = await rpc(db, 'compass_record_contact($1, $2, null, $3)', ['due@example.com', 'email_gate', true]);
  // Opted in but completed the survey → never nudged.
  const doneId = await newSubmission(db);
  await db.query('update submissions set full_survey = true where id = $1', [doneId]);
  const done = await rpc(db, 'compass_record_contact($1, $2, $3, $4)',
    ['done@example.com', 'email_gate', doneId, true]);
  // No opt-in → never nudged.
  const noOptin = await rpc(db, 'compass_record_contact($1, $2)', ['quiet@example.com', 'email_gate']);
  // Wrong source → never nudged.
  const popup = await rpc(db, 'compass_record_contact($1, $2, null, $3)', ['popup@example.com', 'newsletter_popup', true]);

  await db.query("update contacts set created_at = now() - interval '25 hours'");

  const { rows } = await db.query("select * from compass_pending_reminders(1, interval '24 hours')");
  const emails = rows.map((r) => r.email);
  assert.deepEqual(emails, ['due@example.com'],
    `only the opted-in, unfinished, gate-sourced contact is due (got ${JSON.stringify(emails)})`);

  // Stage 2 requires stage 1 to have gone out first.
  assert.equal((await db.query("select * from compass_pending_reminders(2, interval '24 hours')")).rows.length, 0);
  await db.query('select compass_log_email($1, $2, true, null, null)', [due.id, 'reminder_1']);
  await db.query("update contacts set created_at = now() - interval '80 hours'");
  assert.equal((await db.query("select * from compass_pending_reminders(2, interval '72 hours')")).rows.length, 1);

  void done; void noOptin; void popup;
  await db.close();
});

test('counts reproduce the Apps Script ?action=count payload', async () => {
  const db = await createTestDb();
  await newSubmission(db);
  const s2 = await newSubmission(db);
  await db.query('update submissions set full_survey = true where id = $1', [s2]);
  await db.query("insert into historical (country, base_salary, role_raw, yoe_raw) values ('Portugal', 50000, 'x', '3-5')");
  await rpc(db, 'compass_record_contact($1, $2)', ['a@example.com', 'email_gate']);

  const counts = await rpc(db, 'compass_counts()', []);
  assert.deepEqual(counts, { submissions: 2, emails: 1, surveys: 1, historical: 1, total: 3 });
  await db.close();
});

test('constraints reject what Code.gs rejected', async () => {
  const db = await createTestDb();
  const cases = [
    ["a PM with no district", `insert into submissions (base_salary, role, yoe) values (50000, 'PM', 4)`],
    ["a PM with no years", `insert into submissions (base_salary, role, district) values (50000, 'PM', 'Porto')`],
    ["an unknown role", `insert into submissions (base_salary, role, yoe, district) values (50000, 'Ninja', 4, 'Porto')`],
    ["an unknown district", `insert into submissions (base_salary, role, yoe, district) values (50000, 'PM', 4, 'Madrid')`],
    ["a salary over the cap", `insert into submissions (base_salary, role, yoe, district) values (2000000, 'PM', 4, 'Porto')`],
    ["total comp below base", `insert into submissions (base_salary, total_comp, role, yoe, district) values (50000, 10000, 'PM', 4, 'Porto')`],
    ["years beyond 50", `insert into submissions (base_salary, role, yoe, district) values (50000, 'PM', 99, 'Porto')`],
    ["an uppercase email", `insert into contacts (email, source) values ('A@example.com', 'email_gate')`],
    ["a malformed email", `insert into contacts (email, source) values ('nope', 'email_gate')`],
    ["an unknown email source", `insert into contacts (email, source) values ('a@example.com', 'carrier_pigeon')`]
  ];

  for (const [label, sql] of cases) {
    await assert.rejects(() => db.query(sql), undefined, `${label} should have been rejected`);
  }

  // The control: a valid row must still go in, or the test above proves nothing.
  await db.query(`insert into submissions (base_salary, role, yoe, district) values (50000, 'PM', 4, 'Porto')`);
  await db.query(`insert into submissions (role) values ('Not a PM')`);
  assert.equal((await db.query('select count(*)::int c from submissions')).rows[0].c, 2);
  await db.close();
});
