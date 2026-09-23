#!/usr/bin/env node
/**
 * Fills submissions.legacy_id for rows written before 005_legacy_id.sql, by
 * matching them to a fresh export of the Sheet's Submissions tab.
 *
 * Without it, a survey opened from an email link for anyone who compared
 * before this change still reaches the Sheet but 404s here (recorded as an
 * expected compass_mirror_failed), so the two stores drift apart.
 *
 *   # Sheet → File → Download → CSV (Submissions tab) → db/fixtures/submissions.csv
 *   node scripts/backfill-legacy-ids.mjs            # dry run: counts, writes nothing
 *   node scripts/backfill-legacy-ids.mjs --apply
 *
 * Matching: same role, base, total, YoE and district, and a timestamp within
 * WINDOW_MS. Imported rows carry the Sheet's own timestamp (exact match);
 * dual-write rows were stamped by each store separately, a few seconds apart.
 * A row that matches zero or several Sheet rows is reported and left alone:
 * a wrong link would put a survey on someone else's salary.
 *
 * Only ever sets legacy_id where it is null. Re-running is safe.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCsv, mapSubmissions } from './lib/sheet-import.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = 'https://eoebwvslrwwgqvxieijd.supabase.co';
export const WINDOW_MS = 120 * 1000;

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const signature = (r) => [r.role, num(r.base), num(r.total), num(r.yoe), r.district || null].join('|');

/**
 * Pure: pairs database rows with Sheet rows.
 *   dbRows    — { id, created_at, role, base_salary, total_comp, yoe, district }
 *   sheetRows — mapSubmissions() output
 * Returns { matched: [{ id, legacy_id }], unmatched: [id], ambiguous: [id] }.
 */
export function matchLegacyIds(dbRows, sheetRows) {
  const bySig = new Map();
  for (const s of sheetRows) {
    const key = signature(s);
    if (!bySig.has(key)) bySig.set(key, []);
    bySig.get(key).push({ legacy_id: s.legacy_id, t: new Date(s.created_at).getTime() });
  }

  const out = { matched: [], unmatched: [], ambiguous: [] };
  for (const d of dbRows) {
    const key = signature({ role: d.role, base: d.base_salary, total: d.total_comp, yoe: d.yoe, district: d.district });
    const t = new Date(d.created_at).getTime();
    const near = (bySig.get(key) || []).filter((s) => Math.abs(s.t - t) <= WINDOW_MS);
    // Several Sheet rows can share one legacy id (a repeat comparison on the
    // same page): that is still one answer, not an ambiguity.
    const ids = [...new Set(near.map((s) => s.legacy_id))];
    if (ids.length === 1) out.matched.push({ id: d.id, legacy_id: ids[0] });
    else if (ids.length === 0) out.unmatched.push(d.id);
    else {
      // Prefer an exact timestamp (imported rows) before calling it ambiguous.
      const exact = [...new Set(near.filter((s) => s.t === t).map((s) => s.legacy_id))];
      if (exact.length === 1) out.matched.push({ id: d.id, legacy_id: exact[0] });
      else out.ambiguous.push(d.id);
    }
  }
  return out;
}

async function loadKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  const env = await readFile(join(HERE, '..', '.env.local'), 'utf8');
  const read = (name) => env.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1].trim().replace(/^["']|["']$/g, '');
  // The CLI masks the sb_secret_ key; see import-to-supabase.mjs.
  const key = [read('SUPABASE_DEFAULT_KEY'), read('SUPABASE_SERVICE_ROLE_KEY')]
    .find((k) => k && !k.includes('·') && !k.includes('...'));
  if (!key) throw new Error('No usable secret key in db/.env.local');
  return key;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const key = await loadKey();
  const request = async (path, init = {}) => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) }
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`PostgREST ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };

  // Refuses cleanly if 005 has not been applied yet.
  const pending = await request(
    'submissions?legacy_id=is.null&select=id,created_at,role,base_salary,total_comp,yoe,district,source&limit=5000'
  );
  const { rows: sheet } = mapSubmissions(parseCsv(await readFile(join(HERE, '..', 'fixtures', 'submissions.csv'), 'utf8')));
  const result = matchLegacyIds(pending, sheet);

  console.log(`Rows without legacy_id: ${pending.length}   Sheet rows: ${sheet.length}`);
  console.log(`  matched:   ${result.matched.length}`);
  console.log(`  unmatched: ${result.unmatched.length}  (not in this export — re-export if they are recent)`);
  console.log(`  ambiguous: ${result.ambiguous.length}  (left alone)`);

  if (!apply) {
    console.log('\nDry run. Nothing written. Re-run with --apply.');
    return;
  }

  let written = 0;
  for (const m of result.matched) {
    // legacy_id=is.null in the filter: never overwrite a link already set.
    const rows = await request(`submissions?id=eq.${m.id}&legacy_id=is.null`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ legacy_id: m.legacy_id })
    });
    written += rows?.length || 0;
  }
  const left = await request('submissions?legacy_id=is.null&select=id');
  console.log(`\nWrote ${written}. Rows still without legacy_id: ${left.length}`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  main().catch((err) => { console.error(`✖ ${err.message}`); process.exit(1); });
}
