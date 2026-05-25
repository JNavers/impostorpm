const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-TIPM-Client',
  'Access-Control-Max-Age': '86400'
};

const SALARY_COMPASS_URL = 'https://www.impostor.pm/salary-compass/';
const DEFAULT_FROM_EMAIL = 'Javi from The Impostor PM <general@impostor.pm>';
const DEFAULT_REPLY_TO = 'general@impostor.pm';

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.RESEND_API_KEY) {
      return json({ status: 'error', message: 'RESEND_API_KEY is not configured' }, 500);
    }

    const data = await request.json();
    const email = cleanEmail(data.email);
    const source = cleanSource(data.source);
    const token = cleanToken(data.token);
    const template = buildEmailTemplate({ source, token });

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: env.SALARY_COMPASS_FROM_EMAIL || DEFAULT_FROM_EMAIL,
        to: [email],
        reply_to: env.SALARY_COMPASS_REPLY_TO || DEFAULT_REPLY_TO,
        subject: template.subject,
        html: template.html
      })
    });

    const responseText = await response.text();
    if (!response.ok) {
      return json({
        status: 'error',
        message: 'Resend failed',
        resend_status: response.status,
        resend_body: responseText.slice(0, 500)
      }, 502);
    }

    let resend;
    try { resend = JSON.parse(responseText); } catch (_) { resend = {}; }
    return json({
      status: 'ok',
      email_sent: true,
      source,
      token,
      resend_id: resend.id || ''
    });
  } catch (err) {
    return json({ status: 'error', message: err.message || String(err) }, 400);
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function cleanEmail(value) {
  const email = String(value || '').trim().toLowerCase().slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Invalid email');
  }
  return email;
}

function cleanSource(value) {
  const source = String(value || '').trim();
  return /^(dashboard_waitlist|survey_inline)$/.test(source) ? source : 'dashboard_waitlist';
}

function cleanToken(value) {
  return String(value || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 100);
}

function buildEmailTemplate({ source, token }) {
  const dashboardUrl = token ? SALARY_COMPASS_URL + '?access=' + encodeURIComponent(token) : SALARY_COMPASS_URL;

  if (source === 'survey_inline') {
    return {
      subject: 'Your Salary Compass contributor access is reserved',
      html: wrapEmail(
        '<p style="margin:0 0 12px 0; font-size:12px; line-height:1.4; letter-spacing:0.14em; text-transform:uppercase; color:#7A7060; font-weight:700;">Product Salary Compass</p>' +
        '<h1 style="margin:0 0 20px 0; font-size:34px; line-height:1.05; letter-spacing:-0.03em; color:#161616; font-weight:800;">Thanks for contributing.</h1>' +
        '<p style="margin:0 0 18px 0; font-size:17px; line-height:1.55; color:#2B2B2B;">Your survey is now counted in the Product Salary Compass dataset.</p>' +
        '<p style="margin:0 0 24px 0; font-size:17px; line-height:1.55; color:#2B2B2B;">When the dashboard opens, this email gets contributor access so you can explore the compensation cuts we do not publish publicly.</p>' +
        button('Return to Salary Compass', dashboardUrl) +
        '<p style="margin:28px 0 0 0; font-size:14px; line-height:1.55; color:#6B6B6B;">We keep survey answers separate from your public identity. The email is used to send access and launch updates.</p>' +
        '<p style="margin:24px 0 0 0; font-size:15px; line-height:1.55; color:#161616;">- Javi</p>'
      )
    };
  }

  return {
    subject: 'You are on the Salary Compass dashboard list',
    html: wrapEmail(
      '<p style="margin:0 0 12px 0; font-size:12px; line-height:1.4; letter-spacing:0.14em; text-transform:uppercase; color:#7A7060; font-weight:700;">Product Salary Compass</p>' +
      '<h1 style="margin:0 0 20px 0; font-size:34px; line-height:1.05; letter-spacing:-0.03em; color:#161616; font-weight:800;">You are on the list.</h1>' +
      '<p style="margin:0 0 18px 0; font-size:17px; line-height:1.55; color:#2B2B2B;">We saved your email for the Product Salary Compass dashboard launch.</p>' +
      '<p style="margin:0 0 24px 0; font-size:17px; line-height:1.55; color:#2B2B2B;">The public salary comparison stays free. The dashboard will add deeper cuts across role, seniority, location, industry, remote policy and compensation structure.</p>' +
      button('Complete the survey', dashboardUrl) +
      '<p style="margin:28px 0 0 0; font-size:14px; line-height:1.55; color:#6B6B6B;">Completing the full survey helps us make the benchmark stronger and reserves contributor-level dashboard access.</p>' +
      '<p style="margin:24px 0 0 0; font-size:15px; line-height:1.55; color:#161616;">- Javi</p>'
    )
  };
}

function wrapEmail(innerHtml) {
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
  return String(value || '').replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
