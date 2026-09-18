/**
 * Parity: the SQL benchmark must equal the Apps Script benchmark, exactly.
 *
 * This is the gate for the whole migration. If these fail, the cutover would
 * move a number that is already published on impostor.pm, and no amount of
 * "the new one is more correct" makes that acceptable — parity first,
 * improvements after, in a separate change with its own announcement.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestDb, loadFixtures, readBenchmark } from './lib/db.mjs';
import { computePercentiles } from './lib/legacy-benchmark.mjs';
import { generate, edgeCases } from './lib/synthetic.mjs';

/** The oracle omits `suppressed` on healthy buckets; jsonb_build_object does too. */
function assertBucketsMatch(actual, expected, path) {
  assert.deepEqual(
    Object.keys(actual).sort(),
    Object.keys(expected).sort(),
    `${path}: different keys (SQL ${JSON.stringify(Object.keys(actual))} vs oracle ${JSON.stringify(Object.keys(expected))})`
  );
  for (const key of Object.keys(expected)) {
    assert.equal(actual[key], expected[key], `${path}.${key}: SQL ${actual[key]} vs oracle ${expected[key]}`);
  }
}

function assertPayloadsMatch(sql, oracle) {
  assertBucketsMatch(sql.overall, oracle.overall, 'overall');
  assertBucketsMatch(sql.totalComp.overall, oracle.totalComp.overall, 'totalComp.overall');
  assert.equal(sql.totalEntries, oracle.totalEntries, 'totalEntries');

  for (const role of Object.keys(oracle.roles)) {
    assertBucketsMatch(sql.roles[role], oracle.roles[role], `roles.${role}`);
    assertBucketsMatch(sql.totalComp.roles[role], oracle.totalComp.roles[role], `totalComp.roles.${role}`);
  }
  for (const yoe of Object.keys(oracle.yoe)) {
    assertBucketsMatch(sql.yoe[yoe], oracle.yoe[yoe], `yoe.${yoe}`);
    assertBucketsMatch(sql.totalComp.yoe[yoe], oracle.totalComp.yoe[yoe], `totalComp.yoe.${yoe}`);
  }

  assertBucketsMatch(sql.districts.portugal, oracle.districts.portugal, 'districts.portugal');
  assert.deepEqual(
    Object.keys(sql.districts.byDistrict).sort(),
    Object.keys(oracle.districts.byDistrict).sort(),
    'districts.byDistrict: different district sets'
  );
  for (const d of Object.keys(oracle.districts.byDistrict)) {
    assertBucketsMatch(sql.districts.byDistrict[d], oracle.districts.byDistrict[d], `districts.byDistrict.${d}`);
  }
}

test('SQL benchmark matches the Apps Script oracle on a realistic dataset', async () => {
  const data = generate();
  const db = await createTestDb();
  await loadFixtures(db, data);

  const sql = await readBenchmark(db);
  const oracle = computePercentiles(data.historical, data.submissions);

  assertPayloadsMatch(sql, oracle);
  assert.ok(oracle.totalEntries > 500, 'fixture should be big enough to be meaningful');
  await db.close();
});

test('SQL benchmark matches the oracle on edge cases', async () => {
  const data = edgeCases();
  const db = await createTestDb();
  await loadFixtures(db, data);

  const sql = await readBenchmark(db);
  const oracle = computePercentiles(data.historical, data.submissions);

  assertPayloadsMatch(sql, oracle);
  await db.close();
});

test('SQL benchmark matches the oracle across many random datasets', async () => {
  // One seeded dataset can pass by luck. Twenty smaller ones, with different
  // shapes, exercise the suppression boundary from both sides.
  for (let seed = 1; seed <= 20; seed++) {
    const data = generate({ seed, submissions: 40 + seed * 3, historical: 30 + seed * 5 });
    const db = await createTestDb();
    await loadFixtures(db, data);
    try {
      assertPayloadsMatch(await readBenchmark(db), computePercentiles(data.historical, data.submissions));
    } catch (err) {
      throw new Error(`seed ${seed}: ${err.message}`);
    }
    await db.close();
  }
});

test('an empty database returns the published shape, fully suppressed', async () => {
  const db = await createTestDb();
  const sql = await readBenchmark(db);
  const oracle = computePercentiles([], []);

  assertPayloadsMatch(sql, oracle);
  // The frontend indexes into these directly; a missing key is a TypeError.
  assert.equal(sql.overall.suppressed, true);
  assert.equal(sql.roles['APM'].n, 0);
  assert.equal(sql.yoe['13+'].n, 0);
  assert.deepEqual(sql.districts.byDistrict, {});
  await db.close();
});

test('suppression thresholds match the published privacy rule', async () => {
  const db = await createTestDb();
  // 4 rows in a role bucket: below MIN_PUBLIC_BUCKET_N (5), must suppress.
  // 9 rows in a district: below MIN_PUBLIC_DISTRICT_N (10), must suppress.
  await loadFixtures(db, {
    historical: [],
    submissions: [
      ...Array.from({ length: 4 }, (_, i) => ({ role: 'APM', base: 30000 + i, total: null, yoe: 1, district: 'Beja' })),
      ...Array.from({ length: 5 }, (_, i) => ({ role: 'PM', base: 50000 + i, total: null, yoe: 4, district: 'Beja' }))
    ]
  });

  const sql = await readBenchmark(db);
  assert.equal(sql.roles['APM'].suppressed, true, 'n=4 role bucket must be suppressed');
  assert.equal(sql.roles['APM'].n, 4, 'suppressed buckets still report n');
  assert.equal(sql.roles['APM'].p50, 0, 'suppressed buckets zero the percentiles');
  assert.equal(sql.roles['PM'].suppressed, undefined, 'n=5 role bucket must NOT be suppressed');
  assert.equal(sql.districts.byDistrict['Beja'].suppressed, true, 'n=9 district must be suppressed');
  await db.close();
});
