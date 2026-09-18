/**
 * Spins up a throwaway Postgres for the test harness.
 *
 * PGlite is real Postgres 17 compiled to WASM, running in-process with no
 * Docker and no server. It exists here so the migration can be developed and
 * proven without a Supabase project, a network, or any chance of touching
 * production. The SQL under db/sql/ is the same SQL that will be applied to
 * Supabase — nothing in it is PGlite-specific, which is why the schema avoids
 * extensions PGlite lacks (citext, pgcrypto).
 */

import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'sql');

/** Applies every db/sql/*.sql in filename order, the way a migration runner would. */
export async function createTestDb() {
  const db = await PGlite.create();
  const files = (await readdir(SQL_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await readFile(join(SQL_DIR, file), 'utf8');
    try {
      await db.exec(sql);
    } catch (err) {
      throw new Error(`Applying ${file} failed: ${err.message}`);
    }
  }
  return db;
}

/** Loads the oracle's plain-array fixtures into the tables. */
export async function loadFixtures(db, { historical = [], submissions = [] }) {
  for (const row of historical) {
    await db.query(
      `insert into historical (country, base_salary, total_comp, role_raw, yoe_raw, outlier)
       values ($1, $2, $3, $4, $5, $6)`,
      [row.country, row.base, row.total, row.role, row.yoe == null ? null : String(row.yoe), row.outlier === 'TRUE']
    );
  }
  for (const row of submissions) {
    await db.query(
      `insert into submissions (base_salary, total_comp, role, yoe, district, full_survey)
       values ($1, $2, $3, $4, $5, $6)`,
      [row.base, row.total, row.role, row.yoe, row.district || null, row.full_survey === true]
    );
  }
}

/**
 * Reads the benchmark back as JS. PGlite returns numeric as a string to avoid
 * precision loss, so the payload is walked once and every numeric leaf coerced
 * back to Number — otherwise the diff against the oracle would be all
 * "5000" !== 5000 and hide any real disagreement.
 */
export async function readBenchmark(db) {
  const { rows } = await db.query('select compass_benchmark() as payload');
  return numify(rows[0].payload);
}

function numify(value) {
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (Array.isArray(value)) return value.map(numify);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, numify(v)]));
  }
  return value;
}

export { numify };
