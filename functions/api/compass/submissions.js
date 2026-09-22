/**
 * POST /api/compass/submissions
 *
 * Replaces action=create. Creates the row the comparison step produces.
 *
 * The important difference from the Apps Script it replaces is not the storage
 * engine — it is that this returns a real status code. The current frontend
 * posts with `mode: 'no-cors'`, which makes the response unreadable by
 * construction, so a failed write is indistinguishable from a successful one
 * and nothing retries. That is why nobody can say how many of the 430 rows
 * should have been more.
 */

import {
  json, preflight, readJson, supabase, clientIp, hashWithSalt,
  verifyTurnstile, rateLimit, cleanEnum, cleanMoney, cleanNumber, cleanText,
  cleanLegacyId, BadRequest, ALLOWED_ROLES, ALLOWED_DISTRICTS
} from './_lib.js';

export const onRequestOptions = preflight;

export async function onRequestPost({ request, env }) {
  try {
    const data = await readJson(request);
    const ip = clientIp(request);

    const turnstile = await verifyTurnstile(env, data.turnstileToken, ip);
    if (!turnstile.ok) return json({ status: 'error', message: 'Verification failed' }, 403);

    const limited = await rateLimit(env, `submit:${ip}`, { limit: 10, windowSeconds: 3600 });
    if (!limited.ok) return json({ status: 'error', message: 'Too many submissions' }, 429);

    const role = cleanEnum(data.role, ALLOWED_ROLES, 'role');
    const baseSalary = cleanMoney(data.baseSalary, 1, 1000000, 'baseSalary');
    // MATCHES Code.gs: total comp is floored at base, not at 1. A total below
    // base is a typo or a different currency, not a lower-paid person.
    const totalComp = cleanMoney(data.totalComp, baseSalary ?? 1, 1500000, 'totalComp');
    const yoe = cleanNumber(data.yoe, 0, 50, 'yoe');
    const district = data.city ? cleanEnum(data.city, ALLOWED_DISTRICTS, 'city') : null;
    const perceptionGuess = cleanNumber(data.perceptionGuess, 0, 100, 'perceptionGuess');

    // MATCHES createSubmission_: non-PM leads are stored for the newsletter with
    // no salary/years/district, and are excluded from the benchmark by the view.
    if (role !== 'Not a PM' && (yoe === null || !district)) {
      throw new BadRequest('A PM submission needs both years of experience and a district');
    }
    if (role !== 'Not a PM' && baseSalary === null) {
      throw new BadRequest('A PM submission needs a base salary');
    }

    // The Sheet's id for this row, so a survey opened later from an email link
    // (which only knows that id) can still find it. Not unique: a repeat
    // comparison on the same page shares it (see 005_legacy_id.sql). A
    // malformed one is dropped rather than refused: it is bookkeeping.
    let legacyId = null;
    try { legacyId = data.legacyId ? cleanLegacyId(data.legacyId) : null; } catch { legacyId = null; }

    const [created] = await supabase(env).insert('submissions', {
      base_salary: baseSalary,
      total_comp: totalComp,
      role,
      yoe,
      district,
      perception_guess: perceptionGuess,
      source: cleanText(data.source, 40) || null,
      legacy_id: legacyId,
      ip_hash: await hashWithSalt(ip, env.HASH_SALT),
      ua_hash: await hashWithSalt(request.headers.get('User-Agent'), env.HASH_SALT)
    });

    return json({
      status: 'ok',
      id: created.id,
      // Surfaced so a preview deploy cannot look protected while it is not.
      protection: { turnstile: turnstile.skipped ? 'skipped' : 'verified',
                    rateLimit: limited.skipped ? 'skipped' : 'enforced' }
    }, 201);
  } catch (err) {
    if (err instanceof BadRequest) return json({ status: 'error', message: err.message }, 400);
    console.error('create submission failed:', err.message);
    return json({ status: 'error', message: 'Could not save the submission' }, 500);
  }
}
