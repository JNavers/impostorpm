/**
 * APPLY_ALL.sql is what actually gets pasted into Supabase, so it is the file
 * that matters most and the easiest one to forget to regenerate. A copy that
 * quietly lags behind the schema installs the wrong database.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApplyAll } from './build-apply-all.mjs';
import { createTestDb } from './lib/db.mjs';
import { PGlite } from '@electric-sql/pglite';

const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'sql');

test('APPLY_ALL.sql is up to date with its sources', async () => {
  const { content } = await buildApplyAll();
  const onDisk = await readFile(join(SQL_DIR, 'APPLY_ALL.sql'), 'utf8');
  assert.equal(onDisk, content,
    'APPLY_ALL.sql has drifted — run `node scripts/build-apply-all.mjs`');
});

test('APPLY_ALL.sql applies cleanly on its own', async () => {
  // The real test of the paste: one file, one statement stream, nothing else
  // applied first.
  const db = await PGlite.create();
  await db.exec(await readFile(join(SQL_DIR, 'APPLY_ALL.sql'), 'utf8'));

  const { rows } = await db.query(
    "select count(*)::int c from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'"
  );
  assert.ok(rows[0].c >= 15, `expected the compass functions to exist, found ${rows[0].c}`);

  const tables = await db.query(
    "select tablename from pg_tables where schemaname = 'public' order by tablename"
  );
  assert.deepEqual(tables.rows.map((r) => r.tablename),
    ['contacts', 'email_log', 'historical', 'submissions']);

  await db.close();
});

test('re-applying APPLY_ALL.sql is a no-op, not an error', async () => {
  // Re-running after a schema change is the normal workflow, so it has to be
  // safe. If this fails, someone added a statement without IF NOT EXISTS or
  // OR REPLACE.
  const db = await createTestDb();
  const sql = await readFile(join(SQL_DIR, 'APPLY_ALL.sql'), 'utf8');
  await db.exec(sql);
  await db.exec(sql);

  const { rows } = await db.query('select count(*)::int c from submissions');
  assert.equal(rows[0].c, 0, 'and it must not have created or destroyed data');
  await db.close();
});
