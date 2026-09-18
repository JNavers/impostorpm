#!/usr/bin/env node
/**
 * Builds a local Postgres with synthetic data and prints the benchmark.
 *
 * For eyeballing the payload and for trying queries against a dataset shaped
 * like the real one, without touching the Sheet or needing a Supabase project.
 *
 *   node scripts/seed-synthetic.mjs              # in-memory, prints and exits
 *   node scripts/seed-synthetic.mjs ./local-db   # persists, so you can re-open it
 */

import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadFixtures } from './lib/db.mjs';
import { generate } from './lib/synthetic.mjs';

const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'sql');
const dataDir = process.argv[2];

const db = dataDir ? await PGlite.create(dataDir) : await PGlite.create();

for (const file of (await readdir(SQL_DIR)).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(await readFile(join(SQL_DIR, file), 'utf8'));
}

const data = generate();
await loadFixtures(db, data);
await db.query('refresh materialized view benchmark_cache');

const counts = (await db.query('select compass_counts() as c')).rows[0].c;
const payload = (await db.query('select payload from benchmark_cache')).rows[0].payload;

console.log('\nCounts:', JSON.stringify(counts));
console.log(`\nOverall (base):  p25 ${payload.overall.p25}  p50 ${payload.overall.p50}  p75 ${payload.overall.p75}  (n=${payload.overall.n})`);
console.log('\nBy role:');
for (const [role, v] of Object.entries(payload.roles)) {
  console.log(
    `  ${role.padEnd(16)} ${v.suppressed ? `suppressed (n=${v.n})` : `p50 ${String(v.p50).padStart(7)}  n=${v.n}`}`
  );
}
console.log('\nBy district:');
for (const [d, v] of Object.entries(payload.districts.byDistrict)) {
  console.log(
    `  ${d.padEnd(16)} ${v.suppressed ? `suppressed (n=${v.n})` : `p50 ${String(v.p50).padStart(7)}  n=${v.n}`}`
  );
}

if (dataDir) console.log(`\nPersisted to ${dataDir}`);
console.log('\nThis is synthetic data. It is not the benchmark.\n');

await db.close();
