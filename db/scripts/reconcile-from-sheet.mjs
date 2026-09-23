#!/usr/bin/env node
/**
 * Brings Supabase back in line with the Sheet after mirror writes were lost.
 *
 * During dual-write the Sheet is authoritative and the mirror is best effort,
 * so anything it dropped has to be copied across before step 4. From a fresh
 * export of both tabs:
 *
 *   1. comparisons in the Sheet with no row here (by legacy_id) are inserted,
 *      marked source='sheet_backfill' so they stay distinguishable;
 *   2. surveys completed in the Sheet but not here are copied onto the row
 *      the Sheet completed (the FIRST row with that id, as updateSubmission_);
 *   3. contacts captured since --since that are missing here are inserted.
 *      Older contacts were never imported, on purpose, so they are left alone.
 *
 *   # Sheet → File → Download → CSV (Submissions, Emails) → db/fixtures/
 *   node scripts/reconcile-from-sheet.mjs --since 2026-09-22T14:24:15Z --exclude <sheet-id>
 *   node scripts/reconcile-from-sheet.mjs ... --apply
 *
 * --exclude takes Sheet ids to ignore (test rows not yet deleted from the
 * Sheet). Dry run by default. Re-running is safe: it only fills what is missing.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCsv, mapSubmissions } from './lib/sheet-import.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = 'https://eoebwvslrwwgqvxieijd.supabase.co';

const truthy = (v) => ['true', 'yes'].includes(String(v ?? '').trim().toLowerCase());
const intOrNull = (v) => { const n = parseInt(String(v ?? '').trim(), 10); return Number.isFinite(n) ? n : null; };

/**
 * Pure: what Supabase is missing relative to the Sheet.
 *   sheetSubs     — mapSubmissions() rows, in Sheet order
 *   emailRows     — Emails tab rows without the header
 *   supaSubs      — { id, legacy_id, full_survey }
 *   supaContacts  — { email, source }
 */
export function planReconcile({ sheetSubs, emailRows, supaSubs, supaContacts, since, exclude = [] }) {
  const skip = new Set(exclude);
  const known = new Set(supaSubs.map((s) => s.legacy_id).filter(Boolean));
  const supaFull = new Set(supaSubs.filter((s) => s.full_survey).map((s) => s.legacy_id));

  const inserts = sheetSubs.filter((r) => !skip.has(r.legacy_id) && !known.has(r.legacy_id));

  // The Sheet writes a survey to the first row with the id; later rows sharing
  // it stay "No". Only that first row can carry it.
  const firstById = new Map();
  for (const r of sheetSubs) if (!firstById.has(r.legacy_id)) firstById.set(r.legacy_id, r);
  const surveys = [...firstById.values()].filter((r) =>
    r.full_survey && !skip.has(r.legacy_id) && known.has(r.legacy_id) && !supaFull.has(r.legacy_id));

  const haveContact = new Set(supaContacts.map((c) => `${c.email}|${c.source}`));
  const contacts = [];
  const seen = new Set();
  for (const e of emailRows) {
    const ts = String(e[1] ?? '').trim();
    const sid = String(e[0] ?? '').trim();
    const email = String(e[2] ?? '').trim().toLowerCase();
    const source = String(e[3] ?? '').trim();
    if (!ts || ts < since || skip.has(sid) || !email.includes('@')) continue;
    const k = `${email}|${source}`;
    if (haveContact.has(k) || seen.has(k)) continue;
    seen.add(k);
    contacts.push({ sid, email, source, created_at: ts,
      report_optin: truthy(e[4]), newsletter_optin: truthy(e[5]), percentile: intOrNull(e[6]) });
  }
  return { inserts, surveys, contacts };
}

async function loadKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  const env = await readFile(join(HERE, '..', '.env.local'), 'utf8');
  const read = (name) => env.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1].trim().replace(/^["']|["']$/g, '');
  const key = [read('SUPABASE_DEFAULT_KEY'), read('SUPABASE_SERVICE_ROLE_KEY')]
    .find((k) => k && !k.includes('·') && !k.includes('...'));
  if (!key) throw new Error('No usable secret key in db/.env.local');
  return key;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
}

async function main() {
  const apply = process.argv.includes('--apply');
  const since = arg('--since');
  if (!since) throw new Error('--since <ISO timestamp> is required (when dual-write went live)');
  const exclude = process.argv.flatMap((a, i) => (process.argv[i - 1] === '--exclude' ? [a] : []));

  const key = await loadKey();
  const request = async (path, init = {}) => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
        Prefer: 'return=representation', ...(init.headers || {}) }
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`PostgREST ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };

  const { rows: sheetSubs, problems } = mapSubmissions(parseCsv(await readFile(join(HERE, '..', 'fixtures', 'submissions.csv'), 'utf8')));
  if (problems.length) throw new Error(`Submissions header does not match: ${problems.join('; ')}`);
  const emailRows = parseCsv(await readFile(join(HERE, '..', 'fixtures', 'emails.csv'), 'utf8')).slice(1);
  const supaSubs = await request('submissions?select=id,legacy_id,full_survey&limit=10000');
  const supaContacts = await request('contacts?select=email,source&limit=10000');

  const plan = planReconcile({ sheetSubs, emailRows, supaSubs, supaContacts, since, exclude });
  const short = (id) => `${id.slice(0, 8)}…`;
  console.log(`Sheet ${sheetSubs.length} rows / Supabase ${supaSubs.length} rows. Excluding: ${exclude.map(short).join(', ') || 'none'}`);
  console.log(`  comparisons to insert: ${plan.inserts.length}`);
  plan.inserts.forEach((r) => console.log(`    ${r.created_at} ${short(r.legacy_id)} ${r.role} ${r.base}/${r.total ?? '-'} ${r.yoe}y ${r.district} full=${r.full_survey}`));
  console.log(`  surveys to copy:       ${plan.surveys.length}`);
  plan.surveys.forEach((r) => console.log(`    ${short(r.legacy_id)} (${Object.keys(r.survey).length} answers)`));
  console.log(`  contacts to insert:    ${plan.contacts.length}`);
  plan.contacts.forEach((c) => console.log(`    ${c.created_at} ${c.source} → ${c.sid ? short(c.sid) : 'no comparison'}`));

  if (!apply) { console.log('\nDry run. Nothing written. Re-run with --apply.'); return; }

  for (const r of plan.inserts) {
    await request('submissions', { method: 'POST', body: JSON.stringify({
      created_at: r.created_at, legacy_id: r.legacy_id, source: 'sheet_backfill',
      base_salary: r.base, total_comp: r.total, role: r.role, yoe: r.yoe, district: r.district,
      perception_guess: r.perception, full_survey: r.full_survey, survey: r.survey,
      survey_at: r.full_survey ? r.created_at : null
    }) });
  }
  for (const r of plan.surveys) {
    const out = await request('rpc/compass_update_survey_legacy', { method: 'POST',
      body: JSON.stringify({ p_legacy_id: r.legacy_id, p_survey: r.survey }) });
    if (out?.status !== 'ok') throw new Error(`survey copy failed for ${short(r.legacy_id)}: ${JSON.stringify(out)}`);
  }
  // Resolved after the inserts, so a contact can link to a row added above.
  const ids = new Map((await request('submissions?select=id,legacy_id,created_at&legacy_id=not.is.null&order=created_at&limit=10000'))
    .reverse().map((s) => [s.legacy_id, s.id]));
  for (const c of plan.contacts) {
    await request('contacts', { method: 'POST', body: JSON.stringify({
      email: c.email, source: c.source, submission_id: ids.get(c.sid) || null, created_at: c.created_at,
      report_optin: c.report_optin, newsletter_optin: c.newsletter_optin, percentile: c.percentile
    }) });
  }
  // Link contacts the mirror recorded without their comparison.
  let linked = 0;
  for (const e of emailRows) {
    const sid = String(e[0] ?? '').trim();
    const email = String(e[2] ?? '').trim().toLowerCase();
    const source = String(e[3] ?? '').trim();
    if (!sid || !ids.has(sid) || String(e[1] ?? '') < since || exclude.includes(sid)) continue;
    const rows = await request(`contacts?email=eq.${encodeURIComponent(email)}&source=eq.${encodeURIComponent(source)}&submission_id=is.null`,
      { method: 'PATCH', body: JSON.stringify({ submission_id: ids.get(sid) }) });
    linked += rows?.length || 0;
  }

  const after = await request('submissions?select=id,full_survey&limit=10000');
  console.log(`\nApplied. Supabase: ${after.length} rows, ${after.filter((s) => s.full_survey).length} completed surveys. Contacts linked: ${linked}.`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().catch((err) => { console.error(`✖ ${err.message}`); process.exit(1); });
}
