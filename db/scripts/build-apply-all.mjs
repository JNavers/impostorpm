#!/usr/bin/env node
/**
 * Concatenates db/sql/001..004 into db/sql/APPLY_ALL.sql.
 *
 * Supabase's SQL Editor takes one paste, not four, and getting the order wrong
 * fails in ways that are tedious to diagnose (the benchmark functions reference
 * the views, the RLS file references the tables). This removes the chance of
 * pasting them out of order or forgetting one.
 *
 * The output is generated, and the test suite checks it has not drifted from
 * its sources — an APPLY_ALL.sql that quietly lags behind the schema it is
 * supposed to install is worse than not having one.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'sql');
const OUTPUT = join(SQL_DIR, 'APPLY_ALL.sql');

const HEADER = `-- ════════════════════════════════════════════════════════════════════
--  Salary Compass — full schema, ready to paste into the Supabase SQL Editor
--
--  GENERATED FILE. Do not edit: it is db/sql/001..004 concatenated in order.
--  Regenerate with:  node db/scripts/build-apply-all.mjs
--
--  Safe to run more than once: every statement is CREATE ... IF NOT EXISTS or
--  CREATE OR REPLACE, so re-applying it after a change is the normal workflow
--  rather than a recovery step.
--
--  It creates no data and touches nothing outside the public schema.
-- ════════════════════════════════════════════════════════════════════

`;

export async function buildApplyAll() {
  const files = (await readdir(SQL_DIR)).filter((f) => /^0\d+.*\.sql$/.test(f)).sort();
  const parts = [HEADER];
  for (const file of files) {
    parts.push(`\n-- ══════════ ${basename(file)} ══════════\n\n`);
    parts.push(await readFile(join(SQL_DIR, file), 'utf8'));
  }
  return { content: parts.join(''), files };
}

// Only writes when run directly, so the test can import and compare.
if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) {
  const { content, files } = await buildApplyAll();
  await writeFile(OUTPUT, content);
  console.log(`Wrote ${OUTPUT} from ${files.length} files: ${files.join(', ')}`);
}
