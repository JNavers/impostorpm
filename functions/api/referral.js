/**
 * Referrals from /refer/<role>.
 *
 * Same shape as partner-enquiry.js: Resend, a fixed recipient, and an explicit
 * error when something fails so the page can fall back to a mailto instead of
 * pretending the referral went through.
 *
 * The only required field is how to reach the person being referred (their
 * LinkedIn or their email). Everything else is optional on purpose: the point
 * is to make "I know exactly who this could be" a ten-second action.
 */

const FROM = 'The Impostor PM <noreply@impostor.pm>';
const TO = ['general@impostor.pm'];
const MAX_FIELD = 1000;

/** Keep in sync with REFERRAL_ROLES in src/lib/referrals.ts. */
const ROLES = {
  'condukt-product': 'Condukt, Product role',
};

const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;
const LINKEDIN_RE = /^(https?:\/\/)?([a-z]{2,3}\.)?linkedin\.com\/in\/[^\s/?#]+/i;

export async function onRequestPost(context) {
  let data;
  try {
    data = await context.request.json();
  } catch {
    return json({ status: 'error', message: 'Expected JSON' }, 400);
  }

  // Honeypot: a field real people never see. Bots that fill every input get a
  // success response and no email, so they have nothing to retry against.
  if (clean(data.website)) return json({ status: 'ok' });

  const role = typeof data.role === 'string' ? data.role : '';
  const roleLabel = ROLES[role];
  if (!roleLabel) return json({ status: 'error', message: 'Unknown role' }, 400);

  const self = data.self === true;
  const contact = clean(data.contact);
  const candidateName = clean(data.candidateName);
  const why = clean(data.why);
  const referrerName = self ? '' : clean(data.referrerName);
  const referrerEmail = self ? '' : clean(data.referrerEmail);
  const source = clean(data.source).slice(0, 120);

  if (!contact) {
    return json({ status: 'error', message: 'Add a LinkedIn profile or an email address' }, 400);
  }
  if (!EMAIL_RE.test(contact) && !LINKEDIN_RE.test(contact)) {
    return json({ status: 'error', message: 'That should be a LinkedIn profile link or an email address' }, 400);
  }
  if (referrerEmail && !EMAIL_RE.test(referrerEmail)) {
    return json({ status: 'error', message: 'Your email address does not look valid' }, 400);
  }

  const key = context.env.RESEND_API_KEY;
  if (!key) {
    return json({ status: 'error', message: 'Email is not configured on this deployment' }, 503);
  }

  const who = candidateName || contact;
  const subject = self ? `Self-referral: ${roleLabel} (${who})` : `Referral: ${roleLabel} (${who})`;
  const replyTo = EMAIL_RE.test(contact) && self ? contact : referrerEmail;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: TO,
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject,
      text: [
        `Role:        ${roleLabel}`,
        `Type:        ${self ? 'Self-referral' : 'Referral'}`,
        '',
        `Candidate:   ${candidateName || '(no name given)'}`,
        `Contact:     ${contact}`,
        `Why them:    ${why || '(not given)'}`,
        '',
        ...(self ? [] : [`Referred by: ${referrerName || '(anonymous)'}${referrerEmail ? ` <${referrerEmail}>` : ''}`]),
        ...(source ? [`Came from:   ${source}`] : []),
      ].join('\n'),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    return json({ status: 'error', message: 'Could not send the referral', detail: detail.slice(0, 200) }, 502);
  }

  return json({ status: 'ok' });
}

function clean(value) {
  return typeof value === 'string' ? value.trim().slice(0, MAX_FIELD) : '';
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
