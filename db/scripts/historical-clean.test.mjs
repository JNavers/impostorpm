/**
 * The historical clean-up — decisions A–C in docs/agent/DECISIONS.md.
 *
 * These rules delete real rows from a published salary benchmark, so each test
 * names the decision it enforces and the boundary it guards. The boundaries are
 * the whole point: an earlier draft of decision B would have multiplied `450`
 * by 1000 and invented a €450 000 salary.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCsv, mapHistorical } from './lib/sheet-import.mjs';

/** Builds a historical CSV from [country, base, total, role, yoe, outlier] tuples. */
function historicalCsv(tuples) {
  const header = [
    'Where do you reside?',
    'What is your gross annual salary, before taxes, without perks?',
    'What is your gross annual salary, before taxes, with perks included?',
    'Role',
    'How many years of experience do you have in Product?',
    'Outlier'
  ].map((h) => `"${h}"`).join(',');
  return `${header}\n${tuples.map((t) => t.map((c) => `"${c}"`).join(',')).join('\n')}\n`;
}

const clean = (tuples) => mapHistorical(parseCsv(historicalCsv(tuples)), { clean: true });

test('cleaning is OFF by default, so the parity gate keeps comparing like with like', () => {
  const { rows, excluded } = mapHistorical(parseCsv(historicalCsv([
    ['Chile', 3120000000, 3120000000, '02-Mid Product Manager', '3-5', 'FALSE'],
    ['Portugal', 18, 0, '02-Mid Product Manager', '3-5', 'FALSE']
  ])));

  assert.equal(rows.length, 2, 'production aggregates these rows, so the oracle must see them');
  assert.equal(rows[0].base, 3120000000);
  assert.equal(rows[1].base, 18, 'unrepaired');
  assert.deepEqual(excluded, []);
});

test('decision A — non-Portugal rows are dropped', () => {
  const { rows, excluded } = clean([
    ['Portugal', 50000, 55000, '02-Mid Product Manager', '3-5', 'FALSE'],
    ['Chile', 3120000000, 3120000000, '02-Mid Product Manager', '3-5', 'FALSE'],
    ['Spain', 60000, 65000, '02-Mid Product Manager', '3-5', 'FALSE']
  ]);

  assert.deepEqual(rows.map((r) => r.base), [50000]);
  assert.deepEqual(excluded.map((e) => e.reason), ['not-portugal', 'not-portugal']);
  // This is also what removes the row that overflowed `integer` and blocked the
  // import, so no bigint widening is needed.
  assert.ok(!rows.some((r) => r.base > 2147483647));
});

test('decision C — implausibly high rows are dropped, not repaired', () => {
  const { rows, excluded } = clean([
    ['Portugal', 5600000, 7500000, '03-Senior Product Manager', '6-8', 'FALSE'],
    ['Portugal', 225000, 225000, '06-Head of Product', '13+', 'FALSE'],
    ['Portugal', 350000, 360000, '06-Head of Product', '13+', 'FALSE'],
    ['Portugal', 200000, 210000, '06-Head of Product', '13+', 'FALSE'],
    ['Portugal', 95000, 99000, '03-Senior Product Manager', '9-12', 'FALSE']
  ]);

  assert.deepEqual(excluded.map((e) => e.base), [5600000, 225000, 350000]);
  assert.ok(excluded.every((e) => e.reason === 'implausible-high'));
  // 200 000 exactly is the boundary and is KEPT — the rule is "above", not "at".
  assert.deepEqual(rows.map((r) => r.base), [200000, 95000]);
  // The ÷100 hypothesis (5 600 000 → 56 000) was plausible but unproven, and
  // inventing a figure for a public benchmark is worse than losing the row.
  assert.ok(!rows.some((r) => r.base === 56000), 'nothing was repaired into an invented figure');
});

test('decision C — monthly pay and junk are dropped', () => {
  const { rows, excluded } = clean([
    ['Portugal', 3000, 31646, '02-Mid Product Manager', '3-5', 'FALSE'],
    ['Portugal', 1275, 21197, '02-Mid Product Manager', '3-5', 'FALSE'],
    ['Portugal', 150, 100, '02-Mid Product Manager', '3-5', 'FALSE'],
    ['Portugal', 450, 48000, '02-Mid Product Manager', '6-8', 'FALSE'],
    ['Portugal', 10000, 11000, '02-Mid Product Manager', '3-5', 'FALSE']
  ]);

  assert.deepEqual(excluded.map((e) => e.base), [3000, 1275, 150, 450]);
  assert.ok(excluded.every((e) => e.reason === 'implausible-monthly-or-junk'));
  assert.deepEqual(rows.map((r) => r.base), [10000], '10 000 is the boundary and is kept');
});

test('decision B — the thousands shorthand is repaired, and only below 100', () => {
  const { rows, excluded, repaired } = clean([
    ['Portugal', 18, 0, '01-Associate/Junior Product Manager', '0-2', 'FALSE'],
    ['Portugal', 24, 0, '01-Associate/Junior Product Manager', '0-2', 'FALSE'],
    ['Portugal', 70, 0, '03-Senior Product Manager', '6-8', 'FALSE'],
    ['Portugal', 99, 0, '03-Senior Product Manager', '6-8', 'FALSE'],
    ['Portugal', 100, 0, '03-Senior Product Manager', '6-8', 'FALSE']
  ]);

  assert.deepEqual(rows.map((r) => r.base), [18000, 24000, 70000, 99000]);
  assert.equal(repaired.length, 4);
  assert.equal(repaired[0].before, 18);
  assert.equal(repaired[0].after, 18000);
  assert.equal(repaired[0].reason, 'thousands-shorthand');
  // 100 is NOT repaired — it falls into the dropped band. This boundary is the
  // correction the user caught: `450` means 45 000, not 450 000, so a blanket
  // ×1000 across everything under 1000 was rejected.
  assert.deepEqual(excluded.map((e) => e.base), [100]);
});

test('a repaired row scales its with-perks total only when that is shorthand too', () => {
  const { rows } = clean([
    ['Portugal', 18, 20, '01-Associate/Junior Product Manager', '0-2', 'FALSE'],
    ['Portugal', 45, 48000, '02-Mid Product Manager', '3-5', 'FALSE']
  ]);

  assert.equal(rows[0].base, 18000);
  assert.equal(rows[0].total, 20000, 'both figures were shorthand');
  assert.equal(rows[1].base, 45000);
  assert.equal(rows[1].total, 48000, 'a real total must never be multiplied');
});

test('rows the Sheet already flagged as outliers pass through untouched', () => {
  const { rows, excluded } = clean([
    ['Portugal', 5600000, 7500000, '03-Senior Product Manager', '6-8', 'TRUE']
  ]);

  assert.equal(excluded.length, 0, 'someone already made this call; do not re-make it');
  assert.equal(rows[0].base, 5600000);
  assert.equal(rows[0].outlier, true, 'the benchmark filters it on the flag, not the value');
});

test('every excluded row carries its source line, so the log is traceable', () => {
  const { excluded } = clean([
    ['Portugal', 50000, 0, '02-Mid Product Manager', '3-5', 'FALSE'],
    ['Chile', 60000, 0, '02-Mid Product Manager', '3-5', 'FALSE']
  ]);

  assert.equal(excluded[0].line, 3, 'header + two data rows, as a spreadsheet numbers them');
  assert.equal(excluded[0].country, 'Chile', 'and enough of the row to identify it');
});

test('an ordinary row is left completely alone', () => {
  // The control. Without this the tests above only prove that things get
  // deleted, not that the normal path survives.
  const { rows, excluded, repaired } = clean([
    ['Portugal', 45000, 52000, '02-Mid Product Manager', '3-5', 'FALSE']
  ]);

  assert.equal(excluded.length, 0);
  assert.equal(repaired.length, 0);
  assert.equal(rows[0].base, 45000);
  assert.equal(rows[0].total, 52000);
});
