#!/usr/bin/env node
/**
 * End-to-end smoke test of the write endpoints against a deployed preview.
 *
 * Writes to the REAL database, so everything it creates is deleted again in a
 * finally block — including on failure. The point is to prove the write path
 * works in the deployed environment, not to leave test rows in a dataset whose
 * whole value is that it is real.
 *
 * Emails use @example.com, which is IANA-reserved and reaches nobody. The send
 * is expected to fail, which also exercises the "capture succeeded, email did
 * not" path that matters more than the happy one: losing a contact because
 * Resend was rate limited is the worse failure.
 *
 *   node scripts/smoke-test-preview.mjs https://<id>.impostorpm-site.pages.dev
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2];
const SUPABASE_URL = 'https://eoebwvslrwwgqvxieijd.supabase.co';

if (!BASE) {
  console.error('usage: node scripts/smoke-test-preview.mjs <preview-url>');
  process.exit(1);
}

const created = { submissions: [], contacts: [] };
let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ✔ ${label}`);
    passed++;
  } else {
    console.log(`  ✖ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
  return { status: res.status, body };
}

async function admin() {
  const env = await readFile(join(HERE, '..', '.env.local'), 'utf8');
  const m = env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m);
  const key = m[1].trim().replace(/^["']|["']$/g, '');
  return async (path, init = {}) => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: key, Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json', ...(init.headers || {})
      }
    });
    const t = await res.text();
    return t ? JSON.parse(t) : null;
  };
}

const json = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

async function main() {
  const db = await admin();
  console.log(`Target: ${BASE}\n`);

  // ── POST /submissions ──
  console.log('POST /api/compass/submissions');
  const valid = {
    role: 'Senior PM', baseSalary: 61234, totalComp: 70000,
    yoe: 7, city: 'Porto', perceptionGuess: 55
  };
  const create = await api('/api/compass/submissions', json(valid));
  check('a valid submission returns 201', create.status === 201, `got ${create.status} ${JSON.stringify(create.body).slice(0, 120)}`);
  check('and returns a real id', /^[0-9a-f-]{36}$/.test(create.body?.id || ''), JSON.stringify(create.body).slice(0, 120));
  if (create.body?.id) created.submissions.push(create.body.id);

  if (create.body?.id) {
    const [row] = await db(`submissions?id=eq.${create.body.id}&select=*`);
    check('the row is in the database', !!row);
    check('with the salary it was sent', row?.base_salary === 61234, `got ${row?.base_salary}`);
    check('provenance is hashed, not raw', /^[0-9a-f]{32}$/.test(row?.ip_hash || ''), `ip_hash=${row?.ip_hash}`);
  }

  console.log(`  protection: ${JSON.stringify(create.body?.protection || {})}`);

  // ── Validation ──
  console.log('\nRejections');
  for (const [label, payload] of [
    ['unknown role', { ...valid, role: 'Ninja' }],
    ['unknown district', { ...valid, city: 'Madrid' }],
    ['salary over the cap', { ...valid, baseSalary: 5000000 }],
    ['total comp below base', { ...valid, baseSalary: 60000, totalComp: 10000 }],
    ['a PM with no district', { role: 'PM', baseSalary: 50000, yoe: 4 }]
  ]) {
    const res = await api('/api/compass/submissions', json(payload));
    check(`${label} → 400`, res.status === 400, `got ${res.status}`);
  }

  // ── PATCH /submissions/:id ──
  console.log('\nPATCH /api/compass/submissions/:id');
  const id = created.submissions[0];
  if (id) {
    const first = await api(`/api/compass/submissions/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gender: 'Female', industry: 'SaaS', bonus: 5000 })
    });
    check('the survey is accepted', first.status === 200, `got ${first.status} ${JSON.stringify(first.body).slice(0, 120)}`);

    await api(`/api/compass/submissions/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ perks: 'Health insurance' })
    });

    const [row] = await db(`submissions?id=eq.${id}&select=survey,full_survey`);
    check('full_survey is now true', row?.full_survey === true);
    check('a second pass merges rather than wipes',
      row?.survey?.gender === 'Female' && row?.survey?.perks === 'Health insurance',
      JSON.stringify(row?.survey));

    const unknown = await api('/api/compass/submissions/00000000-0000-4000-8000-000000000000', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gender: 'Male' })
    });
    check('an unknown id → 404', unknown.status === 404, `got ${unknown.status}`);

    const malformed = await api('/api/compass/submissions/not-a-uuid', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gender: 'Male' })
    });
    check('a malformed id → 400', malformed.status === 400, `got ${malformed.status}`);
  }

  // ── Survey by Sheet id (email links, 005_legacy_id.sql) ──
  console.log('\nPATCH /api/compass/submissions/:sheetId?by=legacy');
  const legacyId = `smoke-legacy-${Date.now()}`;
  const withLegacy = await api('/api/compass/submissions', json({ ...valid, legacyId }));
  if (withLegacy.body?.id) created.submissions.push(withLegacy.body.id);
  const [legacyRow] = withLegacy.body?.id
    ? await db(`submissions?id=eq.${withLegacy.body.id}&select=legacy_id`) : [];
  check('the comparison stores the Sheet id', legacyRow?.legacy_id === legacyId, JSON.stringify(legacyRow));

  const byLegacy = await api(`/api/compass/submissions/${legacyId}?by=legacy`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gender: 'Female' })
  });
  check('a survey sent by Sheet id → 200', byLegacy.status === 200, `got ${byLegacy.status} ${JSON.stringify(byLegacy.body).slice(0, 120)}`);
  check('and answers with our uuid', !!byLegacy.body?.id && byLegacy.body.id === withLegacy.body?.id, JSON.stringify(byLegacy.body));
  const [enriched] = withLegacy.body?.id
    ? await db(`submissions?id=eq.${withLegacy.body.id}&select=full_survey,survey`) : [];
  check('the survey lands on that row', enriched?.full_survey === true && enriched?.survey?.gender === 'Female', JSON.stringify(enriched));

  const unknownLegacy = await api('/api/compass/submissions/never-created-0001?by=legacy', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gender: 'Male' })
  });
  check('an unknown Sheet id → 404', unknownLegacy.status === 404, `got ${unknownLegacy.status}`);

  // ── POST /contacts ──
  console.log('\nPOST /api/compass/contacts');
  const email = `compass-smoke-${Date.now()}@example.com`;
  const contact = await api('/api/compass/contacts', json({
    email, source: 'email_gate', newsletter_optin: true, percentile: 42
  }));
  check('a capture returns 201', contact.status === 201, `got ${contact.status} ${JSON.stringify(contact.body).slice(0, 160)}`);
  check('and a token', !!contact.body?.token);

  const rows = await db(`contacts?email=eq.${encodeURIComponent(email)}&select=id,newsletter_optin,percentile`);
  if (rows?.length) created.contacts.push(rows[0].id);
  check('the contact is stored even if the email fails', rows?.length === 1);
  check('with its opt-in and percentile', rows?.[0]?.newsletter_optin === true && rows?.[0]?.percentile === 42,
    JSON.stringify(rows?.[0]));

  const log = rows?.length ? await db(`email_log?contact_id=eq.${rows[0].id}&select=kind,ok,error`) : [];
  if (contact.body?.email_suppressed) {
    // COMPASS_SEND_EMAILS is off (dual-write): nothing sent, so nothing logged.
    check('sending is suppressed, and no attempt is logged', log?.length === 0, JSON.stringify(log));
  } else {
    check('and the send attempt is logged either way', log?.length === 1, JSON.stringify(log));
  }
  console.log(`    email_sent=${contact.body?.email_sent} log=${JSON.stringify(log?.[0] || {})}`);

  const repeat = await api('/api/compass/contacts', json({ email, source: 'email_gate' }));
  check('a repeat capture is idempotent', repeat.body?.duplicate === true, JSON.stringify(repeat.body).slice(0, 120));

  const bad = await api('/api/compass/contacts', json({ email: 'not-an-email', source: 'email_gate' }));
  check('a malformed email → 400', bad.status === 400, `got ${bad.status}`);

  // ── cron ──
  console.log('\nPOST /api/compass/cron');
  const noAuth = await api('/api/compass/cron?kind=result', { method: 'POST' });
  check('without the secret → 401', noAuth.status === 401, `got ${noAuth.status}`);
}

async function cleanup() {
  console.log('\nCleaning up…');
  try {
    const db = await admin();
    for (const id of created.contacts) {
      await db(`email_log?contact_id=eq.${id}`, { method: 'DELETE' });
      await db(`contacts?id=eq.${id}`, { method: 'DELETE' });
    }
    for (const id of created.submissions) {
      await db(`submissions?id=eq.${id}`, { method: 'DELETE' });
    }
    console.log(`  removed ${created.submissions.length} submission(s), ${created.contacts.length} contact(s)`);

    // Verify, rather than assume. A smoke test that silently leaves rows in a
    // real dataset is worse than no smoke test.
    for (const id of created.submissions) {
      const left = await db(`submissions?id=eq.${id}&select=id`);
      if (left?.length) console.log(`  ⚠ submission ${id} SURVIVED deletion`);
    }
    for (const id of created.contacts) {
      const left = await db(`contacts?id=eq.${id}&select=id`);
      if (left?.length) console.log(`  ⚠ contact ${id} SURVIVED deletion`);
    }
  } catch (err) {
    console.log(`  ⚠ cleanup failed: ${err.message}`);
    console.log(`     leftover submissions: ${created.submissions.join(', ') || 'none'}`);
    console.log(`     leftover contacts:    ${created.contacts.join(', ') || 'none'}`);
  }
}

try {
  await main();
} catch (err) {
  console.error(`\n✖ ${err.stack || err.message}`);
  failed++;
} finally {
  await cleanup();
}

console.log(`\n${failed ? '✖' : '✔'} ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
