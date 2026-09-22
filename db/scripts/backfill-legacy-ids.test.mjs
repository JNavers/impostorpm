/**
 * backfill-legacy-ids.mjs — the matcher. A wrong pairing would send a survey
 * to someone else's salary, so the cases that must NOT match matter most.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchLegacyIds, WINDOW_MS } from './backfill-legacy-ids.mjs';

const T = '2026-09-10T10:00:00.000Z';
const at = (ms) => new Date(new Date(T).getTime() + ms).toISOString();
const db = (id, created_at, o = {}) => ({ id, created_at, role: 'PM', base_salary: 50000, total_comp: null, yoe: 4, district: 'Porto', ...o });
const sheet = (legacy_id, created_at, o = {}) => ({ legacy_id, created_at, role: 'PM', base: 50000, total: null, yoe: 4, district: 'Porto', ...o });

test('an imported row matches its Sheet row exactly', () => {
  const out = matchLegacyIds([db('u1', T)], [sheet('sid-1', T)]);
  assert.deepEqual(out.matched, [{ id: 'u1', legacy_id: 'sid-1' }]);
});

test('a dual-write row matches despite the two stores stamping it seconds apart', () => {
  const out = matchLegacyIds([db('u1', at(3000))], [sheet('sid-1', T)]);
  assert.equal(out.matched[0].legacy_id, 'sid-1');
});

test('same salary outside the window, or different inputs, do not match', () => {
  const out = matchLegacyIds(
    [db('far', at(WINDOW_MS + 1)), db('other', T, { base_salary: 51000 })],
    [sheet('sid-1', T)]
  );
  assert.deepEqual(out.unmatched.sort(), ['far', 'other']);
  assert.equal(out.matched.length, 0);
});

test('two people with identical inputs a minute apart are ambiguous, not guessed', () => {
  const out = matchLegacyIds([db('u1', at(30000))], [sheet('sid-a', T), sheet('sid-b', at(60000))]);
  assert.deepEqual(out.ambiguous, ['u1']);
});

test('an exact timestamp settles it when two candidates are close', () => {
  const out = matchLegacyIds([db('u1', T)], [sheet('sid-a', T), sheet('sid-b', at(60000))]);
  assert.deepEqual(out.matched, [{ id: 'u1', legacy_id: 'sid-a' }]);
});

test('repeat comparisons sharing one Sheet id are one answer, not an ambiguity', () => {
  const out = matchLegacyIds([db('u1', T)], [sheet('sid-1', T), sheet('sid-1', at(20000))]);
  assert.deepEqual(out.matched, [{ id: 'u1', legacy_id: 'sid-1' }]);
});
