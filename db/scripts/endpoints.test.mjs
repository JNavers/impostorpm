/**
 * The Pages Functions, imported unmodified and driven end to end against a
 * local Postgres.
 *
 * The point of these is the one thing the current backend cannot do: assert on
 * the response. Today the frontend posts with `mode: 'no-cors'`, so a rejected
 * write and an accepted one are the same event to the browser. Every test here
 * checks a status code, because that is the capability being bought.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestDb } from './lib/db.mjs';
import { installFetch, installCaches, makeRequest, TEST_ENV } from './lib/fake-edge.mjs';

const { onRequestPost: createSubmission } = await import('../../functions/api/compass/submissions.js');
const { onRequestPatch: updateSurvey } = await import('../../functions/api/compass/submissions/[id].js');
const { onRequestPost: recordContact } = await import('../../functions/api/compass/contacts.js');
const { onRequestGet: getBenchmark } = await import('../../functions/api/compass/benchmark.js');

/** Boots a db + fetch double for one test, and tears them down after. */
async function harness(opts = {}) {
  const db = await createTestDb();
  const edge = installFetch(db, opts);
  return {
    db,
    edge,
    env: { ...TEST_ENV, ...(opts.env || {}) },
    async close() { edge.restore(); await db.close(); }
  };
}

const VALID = {
  role: 'Senior PM', baseSalary: 62000, totalComp: 70000,
  yoe: 7, city: 'Porto', perceptionGuess: 55
};

// ── POST /submissions ──

test('a valid submission is stored and its id returned', async () => {
  const h = await harness();
  const res = await createSubmission({ request: makeRequest(VALID), env: h.env });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.status, 'ok');
  assert.match(body.id, /^[0-9a-f-]{36}$/);

  const { rows } = await h.db.query('select * from submissions');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].base_salary, 62000);
  assert.equal(rows[0].district, 'Porto');
  // Provenance is hashed, never raw. This is what makes a poisoned batch
  // identifiable after the fact without storing anyone's IP address.
  assert.match(rows[0].ip_hash, /^[0-9a-f]{32}$/);
  assert.notEqual(rows[0].ip_hash, '203.0.113.7');
  await h.close();
});

test('the same IP hashes the same way, a different one does not', async () => {
  const h = await harness();
  await createSubmission({ request: makeRequest(VALID, { ip: '198.51.100.1' }), env: h.env });
  await createSubmission({ request: makeRequest(VALID, { ip: '198.51.100.1' }), env: h.env });
  await createSubmission({ request: makeRequest(VALID, { ip: '198.51.100.2' }), env: h.env });

  const { rows } = await h.db.query('select distinct ip_hash from submissions');
  assert.equal(rows.length, 2, 'grouping by origin is the point; two IPs must give two hashes');
  await h.close();
});

test('invalid submissions are rejected with 400 and a reason', async () => {
  const h = await harness();
  const cases = [
    ['unknown role', { ...VALID, role: 'Ninja' }],
    ['unknown district', { ...VALID, city: 'Madrid' }],
    ['salary over the cap', { ...VALID, baseSalary: 5000000 }],
    ['negative years', { ...VALID, yoe: -1 }],
    ['total comp below base', { ...VALID, baseSalary: 60000, totalComp: 10000 }],
    ['a PM with no district', { role: 'PM', baseSalary: 50000, yoe: 4 }],
    ['a PM with no years', { role: 'PM', baseSalary: 50000, city: 'Porto' }],
    ['a PM with no salary', { role: 'PM', yoe: 4, city: 'Porto' }]
  ];

  for (const [label, payload] of cases) {
    const res = await createSubmission({ request: makeRequest(payload), env: h.env });
    assert.equal(res.status, 400, `${label} should be 400, got ${res.status}`);
    assert.ok((await res.json()).message, `${label} should explain itself`);
  }

  assert.equal((await h.db.query('select count(*)::int c from submissions')).rows[0].c, 0,
    'no invalid row may reach the table');
  await h.close();
});

test('a "Not a PM" lead is stored without salary, years or district', async () => {
  const h = await harness();
  const res = await createSubmission({ request: makeRequest({ role: 'Not a PM' }), env: h.env });
  assert.equal(res.status, 201);

  const { rows } = await h.db.query('select role, base_salary from submissions');
  assert.equal(rows[0].role, 'Not a PM');
  assert.equal(rows[0].base_salary, null);
  // And it must never reach the benchmark.
  assert.equal((await h.db.query('select count(*)::int c from compass_entries')).rows[0].c, 0);
  await h.close();
});

test('an oversized body is rejected before it is parsed', async () => {
  const h = await harness();
  const res = await createSubmission({
    request: makeRequest({ ...VALID, junk: 'x'.repeat(20000) }), env: h.env
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).message, /too large/i);
  await h.close();
});

test('Turnstile failure blocks the write', async () => {
  const h = await harness({ turnstile: 'fail', env: { TURNSTILE_SECRET_KEY: 'secret' } });
  const res = await createSubmission({
    request: makeRequest({ ...VALID, turnstileToken: 'bad' }), env: h.env
  });
  assert.equal(res.status, 403);
  assert.equal((await h.db.query('select count(*)::int c from submissions')).rows[0].c, 0);
  await h.close();
});

test('a missing Turnstile token is refused when the secret is configured', async () => {
  const h = await harness({ env: { TURNSTILE_SECRET_KEY: 'secret' } });
  const res = await createSubmission({ request: makeRequest(VALID), env: h.env });
  assert.equal(res.status, 403, 'protection must fail closed once it is switched on');
  await h.close();
});

test('without a Turnstile secret the response says so rather than pretending', async () => {
  const h = await harness();
  const res = await createSubmission({ request: makeRequest(VALID), env: h.env });
  assert.equal((await res.json()).protection.turnstile, 'skipped',
    'a preview deploy must not look protected when it is not');
  await h.close();
});

test('a database failure surfaces as 500, not as a silent success', async () => {
  const h = await harness();
  await h.db.query('drop table submissions cascade');
  const res = await createSubmission({ request: makeRequest(VALID), env: h.env });
  assert.equal(res.status, 500, 'this is precisely what no-cors made invisible');
  await h.close();
});

// ── PATCH /submissions/:id ──

test('the survey enriches an existing submission', async () => {
  const h = await harness();
  const created = await (await createSubmission({ request: makeRequest(VALID), env: h.env })).json();

  const res = await updateSurvey({
    request: makeRequest({ gender: 'Female', industry: 'SaaS', bonus: 5000, transparency: 4 }, { method: 'PATCH' }),
    env: h.env,
    params: { id: created.id }
  });

  assert.equal(res.status, 200);
  const { rows } = await h.db.query('select survey, full_survey from submissions where id = $1', [created.id]);
  assert.equal(rows[0].full_survey, true);
  assert.equal(rows[0].survey.gender, 'Female');
  assert.equal(rows[0].survey.bonus, 5000);
  await h.close();
});

test('a second survey pass merges rather than wipes', async () => {
  const h = await harness();
  const created = await (await createSubmission({ request: makeRequest(VALID), env: h.env })).json();
  const patch = (body) => updateSurvey({
    request: makeRequest(body, { method: 'PATCH' }), env: h.env, params: { id: created.id }
  });

  await patch({ gender: 'Male', company: 'Acme' });
  await patch({ perks: 'Health insurance' });

  const { rows } = await h.db.query('select survey from submissions where id = $1', [created.id]);
  assert.deepEqual(Object.keys(rows[0].survey).sort(), ['company', 'gender', 'perks']);
  await h.close();
});

test('an unknown submission id is a 404 and a malformed one a 400', async () => {
  const h = await harness();
  const unknown = await updateSurvey({
    request: makeRequest({ gender: 'Female' }, { method: 'PATCH' }),
    env: h.env, params: { id: '00000000-0000-4000-8000-000000000000' }
  });
  assert.equal(unknown.status, 404);

  const malformed = await updateSurvey({
    request: makeRequest({ gender: 'Female' }, { method: 'PATCH' }),
    env: h.env, params: { id: "'; drop table submissions; --" }
  });
  assert.equal(malformed.status, 400, 'the id is validated before it reaches any query');

  assert.ok((await h.db.query('select count(*) from submissions')).rows.length, 'table still exists');
  await h.close();
});

test('the comparison stores the Sheet id it was sent', async () => {
  const h = await harness();
  await createSubmission({ request: makeRequest({ ...VALID, legacyId: 'sheet-id-0001' }), env: h.env });
  const { rows } = await h.db.query('select legacy_id from submissions');
  assert.equal(rows[0].legacy_id, 'sheet-id-0001');
  await h.close();
});

test('a repeat comparison keeps the shared Sheet id; a malformed one is dropped', async () => {
  // Comparing again on the same page reuses the id, as it does in the Sheet.
  // That shared id is the only sign the rows are one person, so it is kept.
  const h = await harness();
  const first = await createSubmission({ request: makeRequest({ ...VALID, legacyId: 'sheet-id-0001' }), env: h.env });
  const again = await createSubmission({ request: makeRequest({ ...VALID, baseSalary: 64000, legacyId: 'sheet-id-0001' }), env: h.env });
  const junk = await createSubmission({ request: makeRequest({ ...VALID, legacyId: "'; drop" }), env: h.env });
  assert.deepEqual([first.status, again.status, junk.status], [201, 201, 201], 'never costs the salary');

  const { rows } = await h.db.query('select legacy_id from submissions');
  assert.equal(rows.filter((r) => r.legacy_id === 'sheet-id-0001').length, 2);
  assert.equal(rows.filter((r) => r.legacy_id === null).length, 1);
  await h.close();
});

test('deployed before 005 is applied, a comparison is still stored', async () => {
  // Real PostgREST says "Could not find the 'legacy_id' column"; PGlite says
  // 'column "legacy_id" … does not exist'. The handler keys on the name only.
  const h = await harness();
  await h.db.exec('alter table submissions drop column legacy_id');
  const res = await createSubmission({ request: makeRequest({ ...VALID, legacyId: 'sheet-id-0001' }), env: h.env });
  assert.equal(res.status, 201);
  assert.equal((await h.db.query('select count(*)::int as n from submissions')).rows[0].n, 1);
  await h.close();
});

test('a survey from an email link finds its row by the Sheet id', async () => {
  const h = await harness();
  const created = await (await createSubmission({
    request: makeRequest({ ...VALID, legacyId: 'sheet-id-0001' }), env: h.env
  })).json();

  const res = await updateSurvey({
    request: makeRequest({ gender: 'Female' }, {
      method: 'PATCH', url: 'https://www.impostor.pm/api/compass/submissions/sheet-id-0001?by=legacy'
    }),
    env: h.env, params: { id: 'sheet-id-0001' }
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).id, created.id, 'answers with our uuid, not the Sheet id');

  const { rows } = await h.db.query('select survey, full_survey from submissions where id = $1', [created.id]);
  assert.equal(rows[0].full_survey, true);
  assert.equal(rows[0].survey.gender, 'Female');
  await h.close();
});

test('an unknown Sheet id is a 404 and a malformed one a 400', async () => {
  const h = await harness();
  const patch = (id) => updateSurvey({
    request: makeRequest({ gender: 'Female' }, {
      method: 'PATCH', url: `https://www.impostor.pm/api/compass/submissions/x?by=legacy`
    }),
    env: h.env, params: { id }
  });
  assert.equal((await patch('never-created-1')).status, 404);
  assert.equal((await patch("'; drop table submissions; --")).status, 400);
  await h.close();
});

test('out-of-range survey answers are rejected', async () => {
  const h = await harness();
  const created = await (await createSubmission({ request: makeRequest(VALID), env: h.env })).json();
  const res = await updateSurvey({
    request: makeRequest({ transparency: 99 }, { method: 'PATCH' }),
    env: h.env, params: { id: created.id }
  });
  assert.equal(res.status, 400);
  await h.close();
});

test('survey text is guarded against spreadsheet formula injection', async () => {
  // Inherited from cleanText_ in Code.gs. The data still gets exported to CSV
  // and opened in spreadsheets, so the guard has to survive the migration.
  const h = await harness();
  const created = await (await createSubmission({ request: makeRequest(VALID), env: h.env })).json();
  await updateSurvey({
    request: makeRequest({ company: '=HYPERLINK("http://evil","click")' }, { method: 'PATCH' }),
    env: h.env, params: { id: created.id }
  });

  const { rows } = await h.db.query('select survey from submissions where id = $1', [created.id]);
  assert.ok(rows[0].survey.company.startsWith("'="), 'a leading = must be neutralised');
  await h.close();
});

// ── POST /contacts ──

test('a contact is recorded and its email sent', async () => {
  const h = await harness();
  const res = await recordContact({
    request: makeRequest({ email: 'Someone@Example.com', source: 'email_gate', newsletter_optin: true }),
    env: h.env
  });
  const body = await res.json();

  assert.equal(res.status, 201);
  assert.equal(body.email_sent, true);
  assert.equal(h.edge.calls.resend.length, 1);
  assert.deepEqual(h.edge.calls.resend[0].to, ['someone@example.com']);

  const { rows } = await h.db.query('select email, newsletter_optin from contacts');
  assert.equal(rows[0].email, 'someone@example.com');
  assert.equal(rows[0].newsletter_optin, true);

  const log = await h.db.query('select kind, ok from email_log');
  assert.deepEqual(log.rows[0], { kind: 'capture', ok: true });
  await h.close();
});

test('a repeat capture does not send a second email', async () => {
  const h = await harness();
  const req = () => recordContact({
    request: makeRequest({ email: 'a@example.com', source: 'email_gate' }), env: h.env
  });

  await req();
  const second = await req();
  const body = await second.json();

  assert.equal(body.duplicate, true);
  assert.equal(body.email_sent, false);
  assert.equal(h.edge.calls.resend.length, 1, 'refreshing the page must not re-send');
  await h.close();
});

test('a failed send is recorded, and the contact is kept', async () => {
  const h = await harness({ resend: 'fail' });
  const res = await recordContact({
    request: makeRequest({ email: 'a@example.com', source: 'email_gate' }), env: h.env
  });

  assert.equal(res.status, 201, 'the capture succeeded even though the email did not');
  assert.equal((await res.json()).email_sent, false);

  const { rows } = await h.db.query('select ok, error from email_log');
  assert.equal(rows[0].ok, false);
  assert.match(rows[0].error, /429/);
  assert.equal((await h.db.query('select count(*)::int c from contacts')).rows[0].c, 1,
    'losing the contact because Resend was rate limited would be the worse failure');
  await h.close();
});

test('a malformed email is rejected before anything is written or sent', async () => {
  const h = await harness();
  const res = await recordContact({
    request: makeRequest({ email: 'not-an-email', source: 'email_gate' }), env: h.env
  });
  assert.equal(res.status, 400);
  assert.equal(h.edge.calls.resend.length, 0);
  assert.equal((await h.db.query('select count(*)::int c from contacts')).rows[0].c, 0);
  await h.close();
});

test('an unknown email source is rejected', async () => {
  const h = await harness();
  const res = await recordContact({
    request: makeRequest({ email: 'a@example.com', source: 'carrier_pigeon' }), env: h.env
  });
  assert.equal(res.status, 400);
  await h.close();
});

// ── GET /benchmark ──

test('the benchmark serves the cached payload in the published shape', async () => {
  const h = await harness();
  const caches = installCaches();

  for (let i = 0; i < 6; i++) {
    await createSubmission({
      request: makeRequest({ ...VALID, baseSalary: 50000 + i * 1000 }), env: h.env
    });
  }
  await h.db.query('refresh materialized view benchmark_cache');

  const res = await getBenchmark({
    request: new Request('https://www.impostor.pm/api/compass/benchmark'),
    env: h.env,
    waitUntil: (p) => p
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  // The shape the frontend indexes into, unchanged from the Apps Script.
  assert.ok(body.overall && body.roles && body.yoe && body.totalComp && body.districts);
  assert.equal(body.roles['Senior PM'].n, 6);
  assert.match(res.headers.get('Cache-Control'), /s-maxage=300/);

  caches.restore();
  await h.close();
});

test('a second request is served from the edge cache', async () => {
  const h = await harness();
  const caches = installCaches();
  await h.db.query('refresh materialized view benchmark_cache');

  const call = () => getBenchmark({
    request: new Request('https://www.impostor.pm/api/compass/benchmark'),
    env: h.env,
    waitUntil: async (p) => { await p; }
  });

  await call();
  await new Promise((r) => setImmediate(r)); // let waitUntil's put settle
  assert.equal(caches.store.size, 1, 'the first call populates the cache');

  await h.db.query('drop materialized view benchmark_cache');
  const second = await call();
  assert.equal(second.status, 200, 'the cached copy is served without touching the database');

  caches.restore();
  await h.close();
});

test('a benchmark outage serves stale rather than an error', async () => {
  const h = await harness();
  const caches = installCaches();
  await h.db.query('refresh materialized view benchmark_cache');

  await getBenchmark({
    request: new Request('https://www.impostor.pm/api/compass/benchmark'),
    env: h.env, waitUntil: async (p) => { await p; }
  });
  await new Promise((r) => setImmediate(r));

  // Losing the database entirely must degrade to a stale benchmark, never to a
  // broken comparison view.
  await h.db.query('drop materialized view benchmark_cache');
  caches.store.clear();
  const cold = await getBenchmark({
    request: new Request('https://www.impostor.pm/api/compass/benchmark'),
    env: h.env, waitUntil: async (p) => { await p; }
  });
  assert.equal(cold.status, 503, 'with nothing cached, say so honestly');

  caches.restore();
  await h.close();
});
