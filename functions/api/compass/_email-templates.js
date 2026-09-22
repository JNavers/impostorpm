/**
 * The Salary Compass transactional emails.
 *
 * Extracted verbatim from functions/api/salary-compass-email.js so that the
 * new /api/compass/contacts endpoint and the existing one render the same
 * markup from one source. Until now this markup existed twice — here, and
 * again in apps-script/salary-compass/Code.gs as string concatenation — so a
 * copy change meant editing two languages and deploying two different ways.
 *
 * Nothing about the content changed in the extraction. Copy edits belong in a
 * separate commit from a refactor, so that a diff of either one is readable.
 */

const SALARY_COMPASS_URL = 'https://www.impostor.pm/salary-compass/';

export function buildEmailTemplate({ source, token, submissionId, email }) {
  const dashboardUrl = token ? SALARY_COMPASS_URL + '?access=' + encodeURIComponent(token) : SALARY_COMPASS_URL;
  const surveyUrl = surveyDeepLink(token, submissionId, email);

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

  if (source === 'email_gate') {
    return {
      subject: 'Your Salary Compass result, and what is still locked',
      html: wrapEmail(
        '<p style="margin:0 0 12px 0; font-size:12px; line-height:1.4; letter-spacing:0.14em; text-transform:uppercase; color:#7A7060; font-weight:700;">Product Salary Compass</p>' +
        '<h1 style="margin:0 0 20px 0; font-size:34px; line-height:1.05; letter-spacing:-0.03em; color:#161616; font-weight:800;">You have seen your number.</h1>' +
        '<p style="margin:0 0 18px 0; font-size:17px; line-height:1.55; color:#2B2B2B;">You just compared your salary against the Portugal PM benchmark. We saved your result so you can come back to it any time.</p>' +
        '<p style="margin:0 0 24px 0; font-size:17px; line-height:1.55; color:#2B2B2B;">The full dashboard is still locked: best-paid industries and companies, the adjusted gender pay gap, remote vs office pay and the highest-paid PM skills. Complete the 2-minute survey to open it.</p>' +
        button('Complete the survey', surveyUrl) +
        '<p style="margin:28px 0 0 0; font-size:14px; line-height:1.55; color:#6B6B6B;">It is anonymous and takes about two minutes. Every answer makes the benchmark sharper for the whole Portuguese PM community.</p>' +
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
      button('Complete the survey', surveyUrl) +
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

function surveyDeepLink(token, submissionId, email) {
  let url = SALARY_COMPASS_URL + '?survey=1';
  if (token) url += '&access=' + encodeURIComponent(token);
  if (submissionId) url += '&sid=' + encodeURIComponent(submissionId);
  if (email) url += '&e=' + encodeURIComponent(email);
  return url;
}

function button(label, url) {
  return '<a href="' + escapeHtml(url) + '" style="display:inline-block; background-color:#FFC600; color:#161616; text-decoration:none; font-weight:700; font-size:16px; padding:14px 24px; border-radius:8px; letter-spacing:-0.01em;">' + escapeHtml(label) + '</a>';
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
