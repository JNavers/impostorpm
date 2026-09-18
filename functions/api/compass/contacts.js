/**
 * POST /api/compass/contacts
 *
 * Replaces action=email_only, and folds in what
 * functions/api/salary-compass-email.js does today.
 *
 * The email templates stay where they already are — this endpoint imports
 * them. Right now the same markup exists twice, once here in JavaScript and
 * once in Code.gs as string concatenation, and a copy change means editing two
 * languages and deploying two ways. Recording the contact and sending its
 * email in one place is most of the point of this endpoint.
 *
 * Ordering is deliberate: record first, send second. An email that goes out
 * against no stored row is a person who was promised access we have no record
 * of owing; a stored row whose email failed is recoverable, and email_log says
 * which ones to retry.
 */

import {
  json, preflight, readJson, supabase, clientIp, verifyTurnstile, rateLimit,
  cleanEmail, cleanEnum, cleanNumber, cleanBool, cleanUuid, BadRequest,
  ALLOWED_EMAIL_SOURCES
} from './_lib.js';
import { buildEmailTemplate } from './_email-templates.js';

export const onRequestOptions = preflight;

export async function onRequestPost({ request, env }) {
  try {
    const data = await readJson(request);
    const ip = clientIp(request);

    const turnstile = await verifyTurnstile(env, data.turnstileToken, ip);
    if (!turnstile.ok) return json({ status: 'error', message: 'Verification failed' }, 403);

    const limited = await rateLimit(env, `contact:${ip}`, { limit: 5, windowSeconds: 3600 });
    if (!limited.ok) return json({ status: 'error', message: 'Too many requests' }, 429);

    const email = cleanEmail(data.email);
    const source = cleanEnum(data.source, ALLOWED_EMAIL_SOURCES, 'source');
    const submissionId = data.submission_id ? cleanUuid(data.submission_id) : null;
    const percentile = cleanNumber(data.percentile, 0, 100, 'percentile');

    const db = supabase(env);
    const contact = await db.rpc('compass_record_contact', {
      p_email: email,
      p_source: source,
      p_submission_id: submissionId,
      p_report_optin: cleanBool(data.report_optin ?? data.reportOptin),
      p_newsletter_optin: cleanBool(data.newsletter_optin ?? data.newsletterOptin),
      p_percentile: percentile === null ? null : Math.round(percentile)
    });

    // A repeat capture is a success for the caller and a no-op for the inbox.
    // Without this, refreshing the thank-you page re-sends the welcome email.
    if (!contact.created) {
      return json({ status: 'ok', token: contact.token, email_sent: false, duplicate: true });
    }

    const sent = await sendCaptureEmail(env, {
      email, source, token: contact.token, submissionId
    });

    // Logged whether it worked or not — this is the record that tells us how
    // many captures silently failed, which the Sheet's single overwritten
    // "Email Error" cell could never answer.
    await db.rpc('compass_log_email', {
      p_contact_id: contact.id,
      p_kind: 'capture',
      p_ok: sent.ok,
      p_resend_id: sent.resendId || null,
      p_error: sent.error || null
    });

    return json({
      status: 'ok',
      token: contact.token,
      email_sent: sent.ok,
      protection: { turnstile: turnstile.skipped ? 'skipped' : 'verified',
                    rateLimit: limited.skipped ? 'skipped' : 'enforced' }
    }, 201);
  } catch (err) {
    if (err instanceof BadRequest) return json({ status: 'error', message: err.message }, 400);
    console.error('record contact failed:', err.message);
    return json({ status: 'error', message: 'Could not save your email' }, 500);
  }
}

async function sendCaptureEmail(env, { email, source, token, submissionId }) {
  if (!env.RESEND_API_KEY) {
    // Explicit rather than thrown: a preview deploy without the key should
    // still record contacts, and the response says the email did not go.
    return { ok: false, error: 'RESEND_API_KEY not configured' };
  }

  const template = buildEmailTemplate({ source, token, submissionId, email });

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: env.SALARY_COMPASS_FROM_EMAIL || 'Javi from The Impostor PM <general@impostor.pm>',
        to: [email],
        reply_to: env.SALARY_COMPASS_REPLY_TO || 'general@impostor.pm',
        subject: template.subject,
        html: template.html
      })
    });

    const body = await res.text();
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 200)}` };

    let parsed = {};
    try { parsed = JSON.parse(body); } catch { /* Resend returned no JSON */ }
    return { ok: true, resendId: parsed.id || '' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
