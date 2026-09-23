/**
 * COMPASS_SEND_EMAILS — the switch that stops dual-write emailing people twice.
 *
 * While Apps Script is authoritative it sends every capture, result and
 * reminder email itself. The new backend must record everything and send
 * nothing, or each person gets each email twice. These tests pin that the
 * switch defaults to OFF and that "off" really means no email leaves.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestDb } from './lib/db.mjs';
import { installFetch, makeRequest, TEST_ENV } from './lib/fake-edge.mjs';

const { onRequestPost: recordContact } = await import('../../functions/api/compass/contacts.js');
const { onRequestPost: cron } = await import('../../functions/api/compass/cron.js');
const { emailsEnabled } = await import('../../functions/api/compass/_lib.js');

const CRON_SECRET = 'test-cron-secret';

/** TEST_ENV with the switch removed entirely — what production has today. */
function envOff(extra = {}) {
  const env = { ...TEST_ENV, CRON_SECRET, ...extra };
  delete env.COMPASS_SEND_EMAILS;
  return env;
}

async function harness() {
  const db = await createTestDb();
  const edge = installFetch(db);
  return { db, edge, async close() { edge.restore(); await db.close(); } };
}

const cronRequest = (kind, extra = '') => new Request(
  `https://www.impostor.pm/api/compass/cron?kind=${kind}${extra}`,
  { method: 'POST', headers: { Authorization: `Bearer ${CRON_SECRET}` } }
);

async function seedDueCapture(db, email, age = '30 hours') {
  const { rows } = await db.query(
    `select compass_record_contact(p_email => $1, p_source => 'email_gate', p_report_optin => true) as out`,
    [email]
  );
  await db.query('update contacts set created_at = now() - $1::interval where id = $2', [age, rows[0].out.id]);
  return rows[0].out.id;
}

test('the switch is OFF unless set to exactly "true"', () => {
  // A missing variable must mean "don't email real people", never "twice".
  assert.equal(emailsEnabled({}), false);
  assert.equal(emailsEnabled(undefined), false);
  assert.equal(emailsEnabled({ COMPASS_SEND_EMAILS: '' }), false);
  assert.equal(emailsEnabled({ COMPASS_SEND_EMAILS: 'false' }), false);
  assert.equal(emailsEnabled({ COMPASS_SEND_EMAILS: '1' }), false, 'no truthy guessing');
  assert.equal(emailsEnabled({ COMPASS_SEND_EMAILS: 'TRUE' }), false, 'exact value only');
  assert.equal(emailsEnabled({ COMPASS_SEND_EMAILS: 'true' }), true);
});

test('off: a capture is recorded but no welcome email is sent', async () => {
  const h = await harness();
  const res = await recordContact({
    request: makeRequest({ email: 'a@example.com', source: 'email_gate', newsletter_optin: true }),
    env: envOff()
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.email_sent, false);
  assert.equal(body.email_suppressed, true);
  assert.equal(h.edge.calls.resend.length, 0, 'nothing may reach Resend');

  const { rows } = await h.db.query('select email, newsletter_optin from contacts');
  assert.equal(rows.length, 1, 'the contact must still be stored — that is the point of dual-write');
  assert.equal(rows[0].newsletter_optin, true);

  const log = await h.db.query('select count(*)::int c from email_log');
  assert.equal(log.rows[0].c, 0, 'no log row: it would claim an attempt that never happened');
  await h.close();
});

test('off: every cron job is a dry run, even when asked for a real one', async () => {
  const h = await harness();
  await seedDueCapture(h.db, 'due@example.com');

  for (const kind of ['result', 'reminder_1']) {
    // Deliberately NOT passing dry=1: the switch must win over the caller.
    const res = await cron({ request: cronRequest(kind), env: envOff() });
    const body = await res.json();
    assert.equal(body.suppressed, true, `${kind}: response must say it was suppressed`);
    assert.equal(body.dryRun, true, `${kind}: forced to a dry run`);
    assert.equal(body.sent, 0);
  }
  assert.equal(h.edge.calls.resend.length, 0, 'nothing may reach Resend');
  await h.close();
});

test('off: nothing is stamped, so turning email on later is a deliberate step', async () => {
  // Suppressed runs must not mark contacts as emailed. The legacy backend did
  // the emailing; the one-off backfill in "Turning email on" is what records
  // that, so the new backend does not re-send it the moment it is switched on.
  const h = await harness();
  const id = await seedDueCapture(h.db, 'due@example.com');

  await cron({ request: cronRequest('reminder_1'), env: envOff() });

  const { rows } = await h.db.query('select reminder_1_at, result_email_at from contacts where id = $1', [id]);
  assert.equal(rows[0].reminder_1_at, null);
  assert.equal(rows[0].result_email_at, null);
  await h.close();
});

test('on: the same capture and job DO send — the control', async () => {
  // Without this the tests above would pass for a backend that could never send.
  const h = await harness();
  await recordContact({
    request: makeRequest({ email: 'b@example.com', source: 'email_gate' }),
    env: { ...TEST_ENV, CRON_SECRET, COMPASS_SEND_EMAILS: 'true' }
  });
  assert.equal(h.edge.calls.resend.length, 1, 'welcome email sent when on');

  await seedDueCapture(h.db, 'due@example.com');
  const body = await (await cron({
    request: cronRequest('reminder_1'),
    env: { ...TEST_ENV, CRON_SECRET, COMPASS_SEND_EMAILS: 'true' }
  })).json();
  assert.equal(body.suppressed, false);
  assert.equal(body.sent, 1, 'reminder sent when on');
  await h.close();
});
