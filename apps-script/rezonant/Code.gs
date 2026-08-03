/**
 * The Impostor PM × Rezonant — landing backend
 * Triggered by POST from /rezonant/index.html.
 *
 * Actions:
 *   - member_redirect : existing TIPM member claims credits (logs + sends Rezonant email)
 *   - new_signup      : new user joins community  (logs + sends Slack welcome + Rezonant email)
 *
 * Setup:
 *   1. Open https://script.google.com/ → New Project, paste this file.
 *   2. Project Settings → Script properties → add:
 *        RESEND_API_KEY = re_...
 *   3. Deploy → New deployment → type: Web app
 *        Execute as: Me
 *        Who has access: Anyone
 *      Copy the Web App URL into rezonant/index.html WEBHOOK_URL.
 *   4. Run any function once to grant scopes (Spreadsheet + UrlFetch + Properties).
 */

// ════════════ CONFIG ════════════
const SHEET_ID       = '1VPF0aEWDhQcMmgv4LstJEqcFzzNnYL5C0L6LVBl3nW0';
const REZONANT_LINK  = 'https://rezonant.dub.link/zYgVSfP';
const SLACK_LINK     = 'https://theimpostorpm.slack.com/join/shared_invite/zt-3xk5yoi6d-AtCWjHnqjyC7gDo931HKhA#/shared-invite/email';
const FROM_EMAIL     = 'Javi from Impostor PM <general@impostor.pm>';
const REPLY_TO       = 'general@impostor.pm';

const SHEET_HEADERS_SIGNUPS = [
  'timestamp', 'firstname', 'lastname', 'email',
  'country', 'city', 'linkedin', 'company',
  'experience', 'role', 'motivation', 'source', 'consent'
];
const SHEET_HEADERS_MEMBERS = ['timestamp', 'email'];


// ════════════ ENTRYPOINT ════════════
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = String(data.action || '');

    if (action === 'member_redirect') {
      appendMember(data);
      sendRezonantEmail(data.email, '');
    } else if (action === 'new_signup') {
      appendSignup(data);
      sendSlackWelcomeEmail(data.email, data.firstname || '');
      sendRezonantEmail(data.email, data.firstname || '');
    } else {
      return jsonResponse({ ok: false, error: 'unknown_action' });
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error(err);
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function doGet() {
  return jsonResponse({ ok: true, service: 'tipm-rezonant' });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


// ════════════ SHEET WRITES ════════════
function appendSignup(data) {
  const sheet = getOrCreateSheet('Signups', SHEET_HEADERS_SIGNUPS);
  sheet.appendRow([
    new Date(),
    data.firstname || '',
    data.lastname  || '',
    data.email     || '',
    data.country   || '',
    data.city      || '',
    data.linkedin  || '',
    data.company   || '',
    data.experience|| '',
    data.role      || '',
    data.motivation|| '',
    data.source    || '',
    data.consent === true || data.consent === 'true'
  ]);
}

function appendMember(data) {
  const sheet = getOrCreateSheet('Members', SHEET_HEADERS_MEMBERS);
  sheet.appendRow([new Date(), data.email || '']);
}

function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}


// ════════════ EMAIL: REZONANT CREDITS ════════════
function sendRezonantEmail(to, firstname) {
  const greeting = firstname ? `Hey ${escapeHtml(firstname)},` : 'Hey there,';
  const html = wrapEmail(`
    <h1 style="margin:0 0 22px 0; font-size:34px; line-height:1.05; letter-spacing:-0.03em; color:#161616; font-weight:800;">
      Your 3,000 Rezonant credits<br>are ready.
    </h1>
    <p style="margin:0 0 20px 0; font-size:17px; line-height:1.55; color:#2B2B2B;">
      ${greeting}
    </p>
    <p style="margin:0 0 24px 0; font-size:17px; line-height:1.55; color:#2B2B2B;">
      Here's your link to claim the 3,000 free Rezonant credits — a perk we put together for The Impostor PM community.
    </p>
    ${button('Claim my credits', REZONANT_LINK)}
    <p style="margin:28px 0 0 0; font-size:14px; line-height:1.55; color:#6B6B6B;">
      Rezonant turns product context, requirements and feedback into PRDs and tickets, and creates engineering-ready tasks grounded in your codebase. Try it on a real product problem this week.
    </p>
    <p style="margin:24px 0 0 0; font-size:15px; line-height:1.55; color:#161616;">
      — Javi
    </p>
  `);

  sendViaResend({
    to,
    subject: 'Your 3,000 Rezonant credits are ready',
    html
  });
}


// ════════════ EMAIL: SLACK WELCOME (new signups only) ════════════
function sendSlackWelcomeEmail(to, firstname) {
  const html = wrapEmail(`
    <h1 style="margin:0 0 22px 0; font-size:38px; line-height:1.05; letter-spacing:-0.03em; color:#161616; font-weight:800; text-align:center;">
      You just got a seat!
    </h1>
    <p style="margin:0 0 18px 0; font-size:17px; line-height:1.55; color:#2B2B2B; text-align:center;">
      Thank you for your answers${firstname ? ', ' + escapeHtml(firstname) : ''}. Now it's time to join our Slack community 🎉
    </p>
    <p style="margin:0 0 24px 0; font-size:17px; line-height:1.55; color:#2B2B2B; text-align:center;">
      Click the button below to start connecting with product people like you.
    </p>
    <div style="text-align:center;">
      ${button('Join Slack', SLACK_LINK)}
    </div>
    <h2 style="margin:36px 0 14px 0; font-size:26px; line-height:1.1; letter-spacing:-0.025em; color:#161616; font-weight:800; text-align:center;">
      Don't know where to start?
    </h2>
    <p style="margin:0; font-size:17px; line-height:1.55; color:#2B2B2B; text-align:center;">
      Introduce yourself in <strong>#introductions</strong> and tell us who you are.
    </p>
  `);

  sendViaResend({
    to,
    subject: 'You just got a seat at The Impostor PM',
    html
  });
}


// ════════════ EMAIL TEMPLATE WRAPPER ════════════
function wrapEmail(innerHtml) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0; padding:0; background-color:#ECE7DC; font-family:'Helvetica Neue', Arial, Helvetica, sans-serif; color:#161616;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ECE7DC;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%;">
        <tr><td style="padding:0 0 24px 0; font-size:13px; line-height:1.3; letter-spacing:0.16em; text-transform:uppercase; color:#161616; font-weight:bold;">
          The Impostor PM
        </td></tr>
        <tr><td style="background-color:#FFF8E5; border-radius:14px; padding:36px 32px;">
          ${innerHtml}
        </td></tr>
        <tr><td style="padding:24px 0 0 0; font-size:12px; line-height:1.5; color:#6B6B6B; text-align:center;">
          You're receiving this because you requested 3,000 Rezonant credits via impostor.pm/rezonant.<br>
          The Impostor PM · A community for Product Managers.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function button(label, url) {
  return `<a href="${url}" style="display:inline-block; background-color:#FFC600; color:#161616; text-decoration:none; font-weight:700; font-size:16px; padding:14px 28px; border-radius:8px; letter-spacing:-0.01em;">${escapeHtml(label)}</a>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}


// ════════════ RESEND TRANSPORT ════════════
function sendViaResend({ to, subject, html }) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('RESEND_API_KEY');
  if (!apiKey) {
    throw new Error('RESEND_API_KEY not set in Script Properties');
  }

  const response = UrlFetchApp.fetch('https://api.resend.com/emails', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + apiKey },
    payload: JSON.stringify({
      from: FROM_EMAIL,
      to: [to],
      reply_to: REPLY_TO,
      subject,
      html
    }),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code >= 300) {
    console.error('Resend ' + code + ': ' + response.getContentText());
    throw new Error('Resend failed: ' + code);
  }
  return JSON.parse(response.getContentText());
}


// ════════════ MANUAL TEST HELPERS (run from editor) ════════════
function _testSignup() {
  doPost({ postData: { contents: JSON.stringify({
    action: 'new_signup',
    firstname: 'Test', lastname: 'User',
    email: 'YOUR_OWN_EMAIL@example.com',
    country: 'Spain', city: 'Madrid',
    linkedin: 'linkedin.com/in/test',
    company: 'Acme',
    experience: 'mid',
    role: 'PM',
    motivation: 'Test motivation',
    source: 'linkedin',
    consent: true
  }) } });
}

function _testMember() {
  doPost({ postData: { contents: JSON.stringify({
    action: 'member_redirect',
    email: 'YOUR_OWN_EMAIL@example.com'
  }) } });
}
