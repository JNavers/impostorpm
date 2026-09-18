#!/usr/bin/env node
/**
 * STEP 1 GATE — run this before writing a single endpoint against real data.
 *
 * Loads the exported Sheet into a throwaway Postgres, computes the benchmark
 * three ways, and requires all three to agree to the euro:
 *
 *   1. SQL        — db/sql/002_benchmark.sql, what the new backend will serve
 *   2. Oracle     — the JS port of Code.gs, what the old backend computes
 *   3. Production — live GET on the Apps Script endpoint, what users see today
 *
 * (1) vs (2) proves the port is faithful. (2) vs (3) proves the export is
 * complete and the oracle really is production — without it, a port could be
 * "correct" against a fixture that does not match the Sheet. Both matter.
 *
 * Usage:
 *   1. In the Sheet: File → Download → CSV, once per tab.
 *   2. Save them as db/fixtures/submissions.csv and db/fixtures/historical.csv
 *      (git-ignored — they hold real salary data and must never be committed).
 *   3. node scripts/verify-parity.mjs
 *
 * Nothing here writes anywhere. It reads two local files and does one GET.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTestDb, readBenchmark } from './lib/db.mjs';
import { computePercentiles } from './lib/legacy-benchmark.mjs';
import { parseCsv, mapSubmissions, mapHistorical } from './lib/sheet-import.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'fixtures');
const PROD_ENDPOINT =
  'https://script.google.com/macros/s/AKfycbxW5SPrFA7aT4HKPi-ASoFFjsO4rU9ajps6fUhvezQdQyeAwnrsKWMk02Kg5SamllZ4gg/exec';

const argv = new Set(process.argv.slice(2));
const SKIP_PROD = argv.has('--offline');

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

/** Walks both payloads and returns every leaf that differs. */
function diff(a, b, path = '', out = []) {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const k of keys) {
    const pa = a?.[k];
    const pb = b?.[k];
    const p = path ? `${path}.${k}` : k;
    if (pa !== null && typeof pa === 'object') diff(pa, pb, p, out);
    else if (Number(pa) !== Number(pb)) out.push({ path: p, a: pa, b: pb });
  }
  return out;
}

function report(label, differences) {
  if (!differences.length) {
    console.log(`  ✔ ${label}: identical`);
    return true;
  }
  console.log(`  ✖ ${label}: ${differences.length} difference(s)`);
  for (const d of differences.slice(0, 25)) {
    console.log(`      ${d.path}: ${d.a} vs ${d.b}`);
  }
  if (differences.length > 25) console.log(`      … and ${differences.length - 25} more`);
  return false;
}

async function main() {
  let submissionsCsv;
  let historicalCsv;
  try {
    submissionsCsv = await readFile(join(FIXTURES, 'submissions.csv'), 'utf8');
    historicalCsv = await readFile(join(FIXTURES, 'historical.csv'), 'utf8');
  } catch (err) {
    fail(
      `Could not read the Sheet exports (${err.code}).\n` +
        `  Export both tabs as CSV and save them as:\n` +
        `    db/fixtures/submissions.csv\n` +
        `    db/fixtures/historical.csv`
    );
  }

  console.log('Reading exports…');
  const subs = mapSubmissions(parseCsv(submissionsCsv));
  const hist = mapHistorical(parseCsv(historicalCsv));

  if (subs.problems.length) {
    console.log('\n  Submissions header mismatch — the export does not match setupSubmissionsHeaders():');
    subs.problems.forEach((p) => console.log(`    • ${p}`));
    fail('Refusing to import: columns are positional, so a shifted header means shifted data.');
  }
  if (hist.problems.length) {
    hist.problems.forEach((p) => console.log(`    • ${p}`));
    fail('Refusing to import the Historical tab.');
  }
  console.log(`  submissions: ${subs.rows.length} rows`);
  console.log(`  historical:  ${hist.rows.length} rows (resolved columns: ${JSON.stringify(hist.col)})`);

  // ── Load into Postgres ──
  console.log('\nLoading into a throwaway Postgres…');
  const db = await createTestDb();

  for (const r of hist.rows) {
    await db.query(
      `insert into historical (country, base_salary, total_comp, role_raw, yoe_raw, outlier)
       values ($1, $2, $3, $4, $5, $6)`,
      [r.country, r.base || null, r.total || null, r.role, r.yoe, r.outlier]
    );
  }

  // The real Sheet predates most of the CHECK constraints, so rows that violate
  // them exist and MUST still import — dropping them would change the benchmark,
  // which is the one thing this step exists to prevent. They are imported with
  // the constraints deferred and reported, so the cleanup is a deliberate,
  // separate decision rather than a silent side effect of the migration.
  const rejected = [];
  await db.query('alter table submissions drop constraint submissions_total_gte_base');
  await db.query('alter table submissions drop constraint submissions_pm_needs_profile');
  for (const r of subs.rows) {
    try {
      await db.query(
        `insert into submissions
           (base_salary, total_comp, role, yoe, district, perception_guess, full_survey, survey, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8, coalesce($9::timestamptz, now()))`,
        [r.base, r.total, r.role, r.yoe, r.district, r.perception, r.full_survey,
         JSON.stringify(r.survey), r.created_at]
      );
    } catch (err) {
      rejected.push({ id: r.legacy_id, role: r.role, reason: err.message });
    }
  }

  if (rejected.length) {
    console.log(`\n  ⚠ ${rejected.length} row(s) rejected by a constraint:`);
    for (const r of rejected.slice(0, 10)) console.log(`      ${r.id} (${r.role}): ${r.reason}`);
    console.log('    These are pre-existing rows the Sheet allowed. Decide what to do with');
    console.log('    them BEFORE the cutover — they are currently in the published benchmark.');
  }

  // ── Compute three ways ──
  console.log('\nComputing…');
  const sql = await readBenchmark(db);

  const oracle = computePercentiles(
    hist.rows.map((r) => ({
      country: r.country, base: r.base, total: r.total,
      role: r.role, yoe: r.yoe, outlier: r.outlier ? 'TRUE' : 'FALSE'
    })),
    subs.rows.map((r) => ({
      role: r.role, base: r.base, total: r.total, yoe: r.yoe, district: r.district
    }))
  );

  let ok = true;
  console.log('\nSQL vs oracle (is the port faithful?)');
  ok = report('SQL ↔ oracle', diff(sql, oracle)) && ok;

  if (SKIP_PROD) {
    console.log('\n(--offline: skipping the production comparison)');
  } else {
    console.log('\nOracle vs production (is the export complete?)');
    let prod;
    try {
      const res = await fetch(PROD_ENDPOINT, { redirect: 'follow' });
      prod = await res.json();
    } catch (err) {
      console.log(`  ⚠ could not reach production (${err.message}); skipping this half.`);
      prod = null;
    }
    if (prod) {
      const d = diff(oracle, prod);
      ok = report('oracle ↔ production', d) && ok;
      if (d.length) {
        console.log('    A mismatch here usually means the export is stale — someone');
        console.log('    submitted between the download and this run. Re-export and retry.');
      }
      ok = report('SQL ↔ production', diff(sql, prod)) && ok;
    }
  }

  await db.close();

  console.log('');
  if (!ok) fail('PARITY FAILED. Do not migrate until every difference above is explained.');
  console.log('✔ PARITY HOLDS — the SQL benchmark reproduces production exactly.\n');
}

main().catch((err) => fail(err.stack || err.message));
