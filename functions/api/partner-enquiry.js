/**
 * Partnership enquiries from /partner-with-us.
 *
 * The Softr version of this page used a native Softr form, which stops working
 * the day the subscription is cancelled — so the page could not be migrated
 * without also replacing the thing that made it useful. This posts to Resend,
 * the same provider the Salary Compass email already uses.
 *
 * Failure is explicit rather than silent. The Salary Compass form spent weeks
 * dropping every submission because the endpoint 405'd and nothing surfaced it;
 * this returns a real status and the page shows a mailto fallback so an enquiry
 * is never quietly lost.
 */

const TO = 'general@impostor.pm';
const FROM = 'The Impostor PM <noreply@impostor.pm>';
const MAX_FIELD = 2000;

export async function onRequestPost(context) {
  let data;
  try {
    data = await context.request.json();
  } catch {
    return json({ status: 'error', message: 'Expected JSON' }, 400);
  }

  const name = clean(data.name);
  const email = clean(data.email);
  const company = clean(data.company);
  const message = clean(data.message);

  if (!name || !email || !message) {
    return json({ status: 'error', message: 'Name, email and message are required' }, 400);
  }
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    return json({ status: 'error', message: 'That email address does not look valid' }, 400);
  }

  const key = context.env.RESEND_API_KEY;
  if (!key) {
    // Configuration problem, not a visitor problem — say so plainly so it shows
    // up in logs as ours to fix rather than looking like a bad submission.
    return json({ status: 'error', message: 'Email is not configured on this deployment' }, 503);
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [TO],
      reply_to: email,
      subject: `Partnership enquiry — ${name}${company ? ` (${company})` : ''}`,
      text: [
        `Name:    ${name}`,
        `Email:   ${email}`,
        `Company: ${company || '—'}`,
        '',
        'How they would like to collaborate:',
        message,
      ].join('\n'),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    return json(
      { status: 'error', message: 'Could not send the enquiry', detail: detail.slice(0, 200) },
      502
    );
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
