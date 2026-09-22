/**
 * GET /api/compass/benchmark
 *
 * Replaces the Apps Script doGet(). Same JSON shape, so the frontend swaps one
 * URL for another and nothing downstream changes.
 *
 * Measured against the endpoint it replaces: 1.06s warm and 3.33s cold, for
 * 3.4kB, on the critical path of the comparison view. Two changes fix that —
 * the payload is precomputed in a materialized view instead of recomputed by
 * walking the whole Sheet, and it is cached at the edge.
 */

import { json, preflight, supabase } from './_lib.js';

const CACHE_SECONDS = 300;          // matches the Apps Script CacheService TTL
const STALE_WHILE_REVALIDATE = 3600;

export const onRequestOptions = preflight;

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).origin + '/api/compass/benchmark', {
    method: 'GET'
  });

  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let payload;
  try {
    const rows = await supabase(env).request('benchmark_cache?select=payload,computed_at');
    if (!rows?.length) throw new Error('benchmark_cache is empty');
    payload = { ...rows[0].payload, computedAt: rows[0].computed_at };
  } catch (err) {
    // A stale benchmark is worth serving; a broken comparison view is not. If
    // the edge has an expired copy, hand that back rather than an error.
    const stale = await cache.match(cacheKey, { ignoreMethod: true });
    if (stale) return stale;
    console.error('benchmark failed:', err.message);
    return json({ status: 'error', message: 'Benchmark unavailable' }, 503);
  }

  const response = json(payload, 200, {
    'Cache-Control': `public, max-age=60, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}`
  });

  waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
