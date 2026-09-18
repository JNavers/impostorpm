/**
 * The scheduled email jobs.
 *
 * These replace two Apps Script time-driven triggers that, per the repo, run
 * with DRY_RUN = true while production almost certainly has them live — a
 * discrepancy nobody can check without opening the web editor. So the first
 * thing these tests establish is that the behaviour is now verifiable at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestDb } from './lib/db.mjs';
import { installFetch, makeRequest, TEST_ENV } from './lib/fake-edge.mjs';

const { onRequestPost: cron } = await import('../../functions/api/compass/cron.js');

const CRON_SECRET = 'test-cron-secret';

async function harness(opts = {}) {
  const db = await createTestDb();
  const edge = installFetch(db, opts);
  return {
    db,
    edge,
    env: { ...TEST_ENV, CRON_SECRET, ...(opts.env || {}) },
    async close() { edge.restore(); await db.close(); }
  };
}

function cronRequest(kind, { secret = CRON_SECRET, dry = false, url } = {}) {
  const target = url || `https://www.impostor.pm/api/compass/cron?kind=${kind}${dry ? '&dry=1' : ''}`;
  return new Request(target, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` }
  });
}

const rpc = async (db, fn, args) => (await db.query(`select ${fn} as out`, args)).rows[0].out;

/** A gate capture that is `age` old, optionally linked to a completed survey. */
async function seedCapture(db, { email, age = '10 minutes', completedSurvey = false, optin = true } = {}) {
  let submissionId = null;
  if (completedSurvey !== null) {
    const { rows } = await db.query(
      `insert into submissions (base_salary, role, yoe, district, full_survey)
       values (50000, 'PM', 4, 'Porto', $1) returning id`, [completedSurvey]
    );
    submissionId = rows[0].id;
  }
  const contact = await rpc(db, 'compass_record_contact($1, $2, $3, $4, $5, $6)',
    [email, 'email_gate', submissionId, optin, false, 55]);
  await db.query('update contacts set created_at = now() - $1::interval where id = $2', [age, contact.id]);
  return { contactId: contact.id, submissionId };
}

// ── Authentication ──

test('the cron endpoint refuses a wrong or missing secret', async () => {
  const h = await harness();

  const bad = await cron({ request: cronRequest('result', { secret: 'nope' }), env: h.env });
  assert.equal(bad.status, 401);

  const none = await cron({
    request: new Request('https://www.impostor.pm/api/compass/cron?kind=result', { method: 'POST' }),
    env: h.env
  });
  assert.equal(none.status, 401);
  assert.equal(h.edge.calls.resend.length, 0);
  await h.close();
});

test('with no CRON_SECRET configured the endpoint fails closed', async () => {
  const h = await harness();
  const res = await cron({ request: cronRequest('result'), env: { ...h.env, CRON_SECRET: undefined } });
  assert.equal(res.status, 500, 'an unset secret must never mean "no auth required"');
  await h.close();
});

test('an unknown job kind is rejected', async () => {
  const h = await harness();
  const res = await cron({ request: cronRequest('delete_everything'), env: h.env });
  assert.equal(res.status, 400);
  await h.close();
});

// ── The deferred result email ──

test('a capture older than the delay gets its result email', async () => {
  const h = await harness();
  await seedCapture(h.db, { email: 'due@example.com', age: '10 minutes' });

  const res = await cron({ request: cronRequest('result'), env: h.env });
  const body = await res.json();

  assert.equal(body.sent, 1);
  assert.equal(h.edge.calls.resend.length, 1);
  assert.deepEqual(h.edge.calls.resend[0].to, ['due@example.com']);

  const { rows } = await h.db.query('select result_email_at from contacts');
  assert.ok(rows[0].result_email_at, 'a successful send stamps the contact');
  await h.close();
});

test('a capture younger than the delay is left alone', async () => {
  // The 7-minute wait is the point of the job: it is what lets the email know
  // whether the person went on to complete the survey.
  const h = await harness();
  await seedCapture(h.db, { email: 'fresh@example.com', age: '2 minutes' });

  const body = await (await cron({ request: cronRequest('result'), env: h.env })).json();
  assert.equal(body.due, 0);
  assert.equal(h.edge.calls.resend.length, 0);
  await h.close();
});

test('a capture older than the lookback is not mailed at all', async () => {
  // Turning the job back on after an outage must not mail days of backlog.
  const h = await harness();
  await seedCapture(h.db, { email: 'ancient@example.com', age: '5 days' });

  const body = await (await cron({ request: cronRequest('result'), env: h.env })).json();
  assert.equal(body.due, 0);
  await h.close();
});

test('the result email drops the survey CTA when the survey is already done', async () => {
  const h = await harness();
  await seedCapture(h.db, { email: 'finished@example.com', completedSurvey: true });
  await seedCapture(h.db, { email: 'unfinished@example.com', completedSurvey: false });

  await cron({ request: cronRequest('result'), env: h.env });

  const sent = Object.fromEntries(h.edge.calls.resend.map((m) => [m.to[0], m]));
  assert.match(sent['unfinished@example.com'].html, /Complete the survey/);
  assert.doesNotMatch(sent['finished@example.com'].html, /Complete the survey/,
    'asking someone to do what they just did is how automation gives itself away');
  assert.match(sent['finished@example.com'].html, /contributor access is reserved|Thank you|thank you/);
  await h.close();
});

test('the result email carries the percentile when there is one', async () => {
  const h = await harness();
  await seedCapture(h.db, { email: 'p@example.com' });
  await cron({ request: cronRequest('result'), env: h.env });
  assert.match(h.edge.calls.resend[0].html, /55th percentile/);
  await h.close();
});

test('a send is not re-sent on the next run', async () => {
  const h = await harness();
  await seedCapture(h.db, { email: 'once@example.com' });

  await cron({ request: cronRequest('result'), env: h.env });
  const second = await (await cron({ request: cronRequest('result'), env: h.env })).json();

  assert.equal(second.due, 0);
  assert.equal(h.edge.calls.resend.length, 1);
  await h.close();
});

test('a FAILED send is retried on the next run', async () => {
  // The Sheet kept one "Email Sent" cell per contact, so a retry erased the
  // record of the failure. Here the failure is logged and the contact stays due.
  const h = await harness({ resend: 'fail' });
  await seedCapture(h.db, { email: 'flaky@example.com' });

  const first = await (await cron({ request: cronRequest('result'), env: h.env })).json();
  assert.equal(first.failed, 1);
  assert.equal(first.sent, 0);

  const { rows: stamp } = await h.db.query('select result_email_at from contacts');
  assert.equal(stamp[0].result_email_at, null, 'a failure must not stamp the contact');

  const second = await (await cron({ request: cronRequest('result'), env: h.env })).json();
  assert.equal(second.due, 1, 'so it comes round again');

  const { rows: log } = await h.db.query('select count(*)::int c from email_log');
  assert.equal(log[0].c, 2, 'and both attempts are on the record');
  await h.close();
});

// ── The nudges ──

test('reminder 1 goes only to opted-in captures with no completed survey', async () => {
  const h = await harness();
  await seedCapture(h.db, { email: 'due@example.com', age: '25 hours', optin: true });
  await seedCapture(h.db, { email: 'done@example.com', age: '25 hours', completedSurvey: true });
  await seedCapture(h.db, { email: 'quiet@example.com', age: '25 hours', optin: false });
  await seedCapture(h.db, { email: 'tooyoung@example.com', age: '2 hours', optin: true });

  const body = await (await cron({ request: cronRequest('reminder_1'), env: h.env })).json();

  assert.equal(body.sent, 1);
  assert.deepEqual(h.edge.calls.resend.map((m) => m.to[0]), ['due@example.com']);
  await h.close();
});

test('reminder 2 waits for reminder 1 to have gone out', async () => {
  const h = await harness();
  const { contactId } = await seedCapture(h.db, { email: 'due@example.com', age: '80 hours' });

  const early = await (await cron({ request: cronRequest('reminder_2'), env: h.env })).json();
  assert.equal(early.due, 0, 'the second nudge cannot precede the first');

  await h.db.query('select compass_log_email($1, $2, true, null, null)', [contactId, 'reminder_1']);
  const later = await (await cron({ request: cronRequest('reminder_2'), env: h.env })).json();
  assert.equal(later.sent, 1);
  await h.close();
});

// ── Dry run ──

test('a dry run reports who would be mailed and sends nothing', async () => {
  const h = await harness();
  await seedCapture(h.db, { email: 'due@example.com' });

  const body = await (await cron({ request: cronRequest('result', { dry: true }), env: h.env })).json();

  assert.equal(body.dryRun, true);
  assert.equal(body.due, 1);
  assert.equal(body.sent, 0);
  assert.equal(h.edge.calls.resend.length, 0);
  // Addresses end up in logs; they do not need to be legible there.
  assert.equal(body.details[0].email, 'du***@example.com');

  const { rows } = await h.db.query('select result_email_at from contacts');
  assert.equal(rows[0].result_email_at, null, 'a dry run changes nothing');
  await h.close();
});

test('the batch is capped so one run cannot mail the whole list', async () => {
  const h = await harness();
  for (let i = 0; i < 5; i++) await seedCapture(h.db, { email: `u${i}@example.com` });

  const body = await (await cron({
    request: cronRequest('result', { url: 'https://www.impostor.pm/api/compass/cron?kind=result&limit=2' }),
    env: h.env
  })).json();

  assert.equal(body.due, 2);
  assert.equal(h.edge.calls.resend.length, 2);
  await h.close();
});
