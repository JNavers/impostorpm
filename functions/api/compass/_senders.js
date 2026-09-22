/**
 * The scheduled emails: the deferred result email, and the two survey nudges.
 *
 * Replaces result-emails.gs (every 5 min) and survey-reminders.gs (hourly).
 * Those two read both sheets into memory and loop; here the question "who is
 * due?" is a query — `compass_pending_reminders` / `compass_pending_results` —
 * which is also what makes it testable.
 *
 * Three properties the Apps Script versions did not have:
 *
 *  • Every attempt is logged, not just the last one. The Sheet kept a single
 *    "Email Sent" cell per contact, so a retry erased the record of the
 *    failure it was retrying.
 *  • A send that fails does not stamp the contact, so it is picked up again.
 *    A send that succeeds stamps it, so it is not.
 *  • `DRY_RUN` is a parameter, not a source edit. The repo copies of both
 *    scripts say `DRY_RUN = true` while production almost certainly has them
 *    live — a discrepancy nobody can check without opening the web editor.
 */

import { buildEmailTemplate } from './_email-templates.js';
import { supabase } from './_lib.js';

const SALARY_COMPASS_URL = 'https://www.impostor.pm/salary-compass/';

/** Matches RESULT_DELAY_MS / REMINDER_*_AFTER_MS in the Apps Script originals. */
export const SCHEDULE = {
  result: '7 minutes',
  reminder1: '24 hours',
  reminder2: '72 hours'
};

/** Safety cap per run, as REMINDER_MAX_PER_RUN / RESULT_MAX_PER_RUN. */
export const MAX_PER_RUN = 80;

/**
 * Sends one batch of whichever kind is due.
 *
 * @param {'result'|'reminder_1'|'reminder_2'} kind
 * @param {{dryRun?: boolean, limit?: number}} options
 */
export async function sendBatch(env, kind, { dryRun = false, limit = MAX_PER_RUN } = {}) {
  const db = supabase(env);
  const due = await fetchDue(db, kind, limit);

  const outcome = { kind, dryRun, due: due.length, sent: 0, failed: 0, details: [] };
  if (!due.length) return outcome;

  for (const contact of due) {
    if (dryRun) {
      outcome.details.push({ email: redact(contact.email), would_send: true });
      continue;
    }

    const result = await sendOne(env, kind, contact);

    // Logged whether it worked or not, and the log is what drives the retry:
    // compass_log_email only stamps the contact when ok is true, so a failure
    // leaves the row due for the next run.
    await db.rpc('compass_log_email', {
      p_contact_id: contact.contact_id,
      p_kind: kind,
      p_ok: result.ok,
      p_resend_id: result.resendId || null,
      p_error: result.error || null
    });

    if (result.ok) outcome.sent++;
    else outcome.failed++;
    outcome.details.push({ email: redact(contact.email), ok: result.ok, error: result.error });
  }

  return outcome;
}

async function fetchDue(db, kind, limit) {
  if (kind === 'result') {
    return db.rpc('compass_pending_results', {
      p_after: SCHEDULE.result,
      p_limit: limit
    });
  }
  const stage = kind === 'reminder_1' ? 1 : 2;
  return db.rpc('compass_pending_reminders', {
    p_stage: stage,
    p_after: stage === 1 ? SCHEDULE.reminder1 : SCHEDULE.reminder2,
    p_limit: limit
  });
}

async function sendOne(env, kind, contact) {
  if (!env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY not configured' };

  const template = kind === 'result'
    ? buildResultEmail(contact)
    : buildEmailTemplate({
      source: 'email_gate',
      token: contact.token,
      submissionId: contact.submission_id,
      email: contact.email
    });

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: env.SALARY_COMPASS_FROM_EMAIL || 'Javi from The Impostor PM <general@impostor.pm>',
        to: [contact.email],
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

/**
 * The deferred result email.
 *
 * Sent ~7 minutes after the gate capture rather than immediately, which is the
 * one genuinely clever thing in result-emails.gs: by waiting, it can tell
 * whether the person went on to complete the survey in the same session, and
 * drop the survey CTA if they did. Asking someone to do what they just did is
 * the fastest way to look automated.
 */
function buildResultEmail(contact) {
  const done = contact.full_survey === true;
  const surveyUrl = `${SALARY_COMPASS_URL}?survey=1` +
    (contact.token ? `&access=${encodeURIComponent(contact.token)}` : '') +
    (contact.submission_id ? `&sid=${encodeURIComponent(contact.submission_id)}` : '') +
    (contact.email ? `&e=${encodeURIComponent(contact.email)}` : '');

  const percentile = Number.isFinite(Number(contact.percentile)) && contact.percentile !== null
    ? `<p style="margin:0 0 18px 0; font-size:17px; line-height:1.55; color:#2B2B2B;">You landed around the <strong>${escapeHtml(String(contact.percentile))}th percentile</strong> of the Portuguese Product benchmark.</p>`
    : '';

  const body = done
    ? percentile +
      '<p style="margin:0 0 24px 0; font-size:17px; line-height:1.55; color:#2B2B2B;">You completed the full survey, so your answers are in the dataset and your contributor access is reserved. Thank you — the benchmark is only as good as the people who fill it in.</p>' +
      button('Return to Salary Compass', SALARY_COMPASS_URL)
    : percentile +
      '<p style="margin:0 0 24px 0; font-size:17px; line-height:1.55; color:#2B2B2B;">The deeper cuts are still locked: best-paid industries, the adjusted pay gap, remote versus office, and which skills actually move the number. The 2-minute survey opens them.</p>' +
      button('Complete the survey', surveyUrl);

  return {
    subject: done ? 'Your Salary Compass result' : 'Your Salary Compass result, and what is still locked',
    html: wrap(
      '<p style="margin:0 0 12px 0; font-size:12px; line-height:1.4; letter-spacing:0.14em; text-transform:uppercase; color:#7A7060; font-weight:700;">Product Salary Compass</p>' +
      '<h1 style="margin:0 0 20px 0; font-size:34px; line-height:1.05; letter-spacing:-0.03em; color:#161616; font-weight:800;">You have seen your number.</h1>' +
      body +
      '<p style="margin:24px 0 0 0; font-size:15px; line-height:1.55; color:#161616;">- Javi</p>'
    )
  };
}

/** Same shell as _email-templates.js; kept here so that file stays a verbatim extract. */
function wrap(innerHtml) {
  return '<!DOCTYPE html>' +
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
    '<body style="margin:0; padding:0; background-color:#ECE7DC; font-family:Helvetica, Arial, sans-serif; color:#161616;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ECE7DC;"><tr><td align="center" style="padding:32px 16px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%;">' +
    '<tr><td style="padding:0 0 24px 0; font-size:13px; line-height:1.3; letter-spacing:0.16em; text-transform:uppercase; color:#161616; font-weight:bold;">The Impostor PM</td></tr>' +
    '<tr><td style="background-color:#FFF8E5; border-radius:14px; padding:36px 32px;">' + innerHtml + '</td></tr>' +
    '<tr><td style="padding:24px 0 0 0; font-size:12px; line-height:1.5; color:#6B6B6B; text-align:center;">You are receiving this because you shared your email on the Product Salary Compass.<br>The Impostor PM - A community for Product Managers.</td></tr>' +
    '</table></td></tr></table></body></html>';
}

function button(label, url) {
  return '<a href="' + escapeHtml(url) + '" style="display:inline-block; background-color:#FFC600; color:#161616; text-decoration:none; font-weight:700; font-size:16px; padding:14px 24px; border-radius:8px; letter-spacing:-0.01em;">' + escapeHtml(label) + '</a>';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Run summaries end up in logs; an address does not need to be in them. */
function redact(email) {
  const [user, domain] = String(email ?? '').split('@');
  if (!domain) return '(invalid)';
  return `${user.slice(0, 2)}***@${domain}`;
}
