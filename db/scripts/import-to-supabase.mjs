#!/usr/bin/env node
/**
 * Imports the Sheet exports into the real Supabase project.
 *
 * Applies the clean-up from decisions A–C, so what lands in `historical` is the
 * cleaned set, not the raw Sheet. Submissions are imported as-is: they come
 * through the validated API and are trusted.
 *
 * Refuses to run against a non-empty database unless --force is passed. This
 * is the one script here that writes to a real remote, and running it twice by
 * accident would double every row and move the published benchmark.
 *
 *   node scripts/import-to-supabase.mjs --dry     # counts only, writes nothing
 *   node scripts/import-to-supabase.mjs
 *
 * Credentials come from db/.env.local (git-ignored), written by:
 *   supabase projects api-keys --project-ref <ref> -o env > db/.env.local
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCsv, mapSubmissions, mapHistorical } from './lib/sheet-import.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'fixtures');

const argv = new Set(process.argv.slice(2));
const DRY = argv.has('--dry');
const FORCE = argv.has('--force');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://eoebwvslrwwgqvxieijd.supabase.co';

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

/** Reads db/.env.local without printing anything from it. */
async function loadKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  let env;
  try {
    env = await readFile(join(HERE, '..', '.env.local'), 'utf8');
  } catch {
    fail('db/.env.local not found. Run:\n' +
      '    supabase projects api-keys --project-ref <ref> -o env > db/.env.local');
  }
  // Prefer the sb_secret_ key over the legacy JWT. New Supabase projects ship
  // with the JWT-format anon/service_role keys present in the CLI's output but
  // disabled on the API, which fails as a flat "Invalid API key" — confusing,
  // because the key is right there and looks well formed.
  const read = (name) => {
    const m = env.match(new RegExp(`^${name}=(.+)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
  };

  // The CLI MASKS the sb_secret_ key with middle dots rather than printing it,
  // so SUPABASE_DEFAULT_KEY arrives truncated and fails as "Invalid API key" —
  // which reads like a typo and is not one. The legacy service_role JWT is
  // printed in full, so that is the one to use.
  const usable = (k) => k && !k.includes('·') && !k.includes('...');

  const candidates = [read('SUPABASE_DEFAULT_KEY'), read('SUPABASE_SERVICE_ROLE_KEY')];
  const key = candidates.find(usable);
  if (!key) {
    fail('No usable secret key in db/.env.local — every candidate is masked.\n' +
      '  Copy the service_role key from the Supabase dashboard (Settings → API)\n' +
      '  into db/.env.local as SUPABASE_SERVICE_ROLE_KEY=<value>');
  }
  return key;
}

function client(key) {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json'
  };
  return async function request(path, init = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers || {}) }
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`PostgREST ${res.status}: ${text.slice(0, 400)}`);
    return text ? JSON.parse(text) : null;
  };
}

/** PostgREST accepts an array insert; 500 at a time keeps the body sane. */
async function insertAll(request, table, rows, size = 500) {
  let done = 0;
  for (let i = 0; i < rows.length; i += size) {
    const batch = rows.slice(i, i + size);
    await request(table, {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(batch)
    });
    done += batch.length;
    process.stdout.write(`\r    ${table}: ${done}/${rows.length}`);
  }
  process.stdout.write('\n');
}

async function main() {
  console.log(`Target: ${SUPABASE_URL}${DRY ? '  (DRY RUN)' : ''}\n`);

  const subs = mapSubmissions(parseCsv(await readFile(join(FIXTURES, 'submissions.csv'), 'utf8')));
  const hist = mapHistorical(parseCsv(await readFile(join(FIXTURES, 'historical.csv'), 'utf8')), { clean: true });

  if (subs.problems.length) {
    subs.problems.forEach((p) => console.log(`  • ${p}`));
    fail('Submissions header mismatch — columns are positional, so this would shift data.');
  }

  const byReason = {};
  for (const e of hist.excluded) byReason[e.reason] = (byReason[e.reason] || 0) + 1;

  console.log(`  submissions: ${subs.rows.length}`);
  console.log(`  historical:  ${hist.rows.length} kept, ${hist.excluded.length} dropped`);
  for (const [r, n] of Object.entries(byReason)) console.log(`    ${r.padEnd(30)} ${n}`);
  console.log(`  repaired:    ${hist.repaired.length} (${hist.repaired.map((r) => `${r.before}→${r.after}`).join(', ')})`);

  if (DRY) {
    console.log('\n(dry run — nothing written)\n');
    return;
  }

  const request = client(await loadKey());

  // Guard: this is the only script that writes to a real remote, and running it
  // twice would double every row and move the published benchmark.
  const existing = await request('submissions?select=id&limit=1');
  const existingHist = await request('historical?select=id&limit=1');
  if ((existing.length || existingHist.length) && !FORCE) {
    fail('The database already holds rows. Re-importing would duplicate them.\n' +
      '  Truncate first, or pass --force if you know what you are doing.');
  }

  console.log('\nImporting…');
  await insertAll(request, 'historical', hist.rows.map((r) => ({
    country: r.country,
    base_salary: r.base || null,
    total_comp: r.total || null,
    role_raw: r.role,
    yoe_raw: r.yoe,
    outlier: r.outlier
  })));

  // The Sheet predates several of the constraints, so a row can be refused.
  // Reported individually rather than aborting the batch: knowing which five
  // rows are malformed is more useful than losing the other four hundred.
  const rejected = [];
  const ok = [];
  for (const r of subs.rows) {
    const row = {
      base_salary: r.base,
      total_comp: r.total,
      role: r.role,
      yoe: r.yoe,
      district: r.district,
      perception_guess: r.perception,
      full_survey: r.full_survey,
      survey: r.survey,
      created_at: r.created_at || undefined,
      source: 'sheet_import'
    };
    ok.push(row);
  }

  try {
    await insertAll(request, 'submissions', ok);
  } catch (err) {
    console.log(`\n  batch insert refused (${err.message.slice(0, 120)}…), retrying row by row`);
    for (const row of ok) {
      try {
        await request('submissions', {
          method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row)
        });
      } catch (rowErr) {
        rejected.push({ role: row.role, base: row.base_salary, reason: rowErr.message.slice(0, 160) });
      }
    }
  }

  if (rejected.length) {
    console.log(`\n  ⚠ ${rejected.length} submission(s) refused by a constraint:`);
    for (const r of rejected.slice(0, 10)) console.log(`      ${r.role} ${r.base}: ${r.reason}`);
  }

  console.log('\nRefreshing the benchmark…');
  await request('rpc/refresh_benchmark_cache', { method: 'POST', body: '{}' });

  const counts = await request('rpc/compass_counts', { method: 'POST', body: '{}' });
  console.log(`\n✔ Imported. Counts: ${JSON.stringify(counts)}\n`);
}

main().catch((err) => fail(err.stack || err.message));
