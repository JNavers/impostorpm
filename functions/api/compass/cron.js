/**
 * POST /api/compass/cron?kind=result|reminder_1|reminder_2
 *
 * The scheduled email jobs, triggered by a Cloudflare Cron Trigger (or by
 * anything else holding the shared secret). Replaces the two Apps Script
 * time-driven triggers.
 *
 * It is an authenticated endpoint rather than a Worker `scheduled()` handler so
 * that it can be invoked by hand — `?dry=1` answers "who would this email right
 * now?" without sending anything, which is what `DRY_RUN` was for in the Apps
 * Script versions. The difference is that this one does not require editing and
 * redeploying the source to find out, and cannot be left switched the wrong way
 * by accident.
 */

import { json, preflight, emailsEnabled } from './_lib.js';
import { sendBatch, MAX_PER_RUN } from './_senders.js';

const KINDS = new Set(['result', 'reminder_1', 'reminder_2']);

export const onRequestOptions = preflight;

export async function onRequestPost({ request, env }) {
  // Fails closed, and without the timing side channel a plain === would leak.
  if (!env.CRON_SECRET) {
    return json({ status: 'error', message: 'CRON_SECRET is not configured' }, 500);
  }
  const presented = request.headers.get('Authorization') || '';
  if (!timingSafeEqual(presented, `Bearer ${env.CRON_SECRET}`)) {
    return json({ status: 'error', message: 'Unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') || '';
  if (!KINDS.has(kind)) {
    return json({ status: 'error', message: `kind must be one of ${[...KINDS].join(', ')}` }, 400);
  }

  // With sending switched off every run is a dry run, whatever the caller asked
  // for: it reports who WOULD be mailed, sends nothing and stamps nothing. Not
  // stamping matters — see "Turning email on" in db/README.md for the one-off
  // backfill that stops the new backend re-sending what the legacy one sent.
  const suppressed = !emailsEnabled(env);
  const dryRun = suppressed || url.searchParams.get('dry') === '1';
  const limit = Math.min(Number(url.searchParams.get('limit')) || MAX_PER_RUN, MAX_PER_RUN);

  try {
    const outcome = await sendBatch(env, kind, { dryRun, limit });
    return json({ status: 'ok', ...outcome, suppressed });
  } catch (err) {
    console.error(`cron ${kind} failed:`, err.message);
    return json({ status: 'error', message: 'Job failed', kind }, 500);
  }
}

/** Constant-time comparison; length is allowed to leak, the secret is not. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
