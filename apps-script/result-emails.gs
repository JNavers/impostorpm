/* ════════════════════════════════════════════════════════════════════
 *  RESULT EMAILS  —  paste into the LIVE Apps Script (web editor).
 *
 *  Sends the "here is your result" email ~7 min AFTER the email gate capture
 *  (not instantly), so we can check whether the person completed the survey
 *  in the same session and skip the redundant survey CTA.
 *
 *    • Always includes the person's real result (salary, percentile, position).
 *    • Survey NOT completed  -> result + "Complete the survey" CTA (deep-link).
 *    • Survey completed       -> result + "thanks, dashboard unlocks at 500".
 *
 *  DEPENDS ON one small edit in Code.gs (see note at the bottom):
 *    cleanEmailSource_ must allow 'email_gate'.
 *
 *  ─ ONE-TIME SETUP ─────────────────────────────────────────────────
 *   1) Emails sheet → add header in M1: "Result Email Sent".
 *   2) Apply the one-line Code.gs edit (bottom of this file).
 *   3) Triggers → Add Trigger: sendResultEmails | Time-driven | Minutes timer |
 *      every 5 minutes.
 *
 *  Set RESULT_DRY_RUN = true first → it only LOGS who would be emailed.
 * ════════════════════════════════════════════════════════════════════ */

var RESULT_DRY_RUN     = true;                         // flip to false to actually send
var RESULT_DELAY_MS    = 7 * 60 * 1000;                // wait 7 min after capture
var RESULT_LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;      // ignore captures older than 3 days
var RESULT_MAX_PER_RUN = 80;
var RESULT_GOAL        = 500;                           // dashboard unlock target
var RESULT_SURVEY_URL  = 'https://www.impostor.pm/salary-compass/';

function sendResultEmails() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var emails = ss.getSheetByName('Emails');
  var subs   = ss.getSheetByName('Submissions');
  if (!emails || !subs) throw new Error('Emails/Submissions sheet not found');

  // Map Submission ID -> result fields (cols: 1 ID, 3 Base, 4 Total, 5 Role, 6 YoE, 7 City, 21 Full Survey)
  var sv = subs.getDataRange().getValues();
  var byId = {};
  for (var s = 1; s < sv.length; s++) {
    var id = String(sv[s][0]).trim();
    if (!id) continue;
    byId[id] = {
      base:  Number(sv[s][2]) || 0,
      total: Number(sv[s][3]) || 0,
      role:  String(sv[s][4] || '').trim(),
      yoe:   sv[s][5],
      city:  String(sv[s][6] || '').trim(),
      done:  String(sv[s][20]).trim().toLowerCase() === 'yes'
    };
  }

  // Emails cols: 1 SubID, 2 Timestamp, 3 Email, 4 Source, 7 Percentile, 8 Token,
  // 9 Email Sent, 13 Result Email Sent
  var rows = emails.getDataRange().getValues();
  var now = Date.now();
  var processed = 0;

  for (var i = 1; i < rows.length && processed < RESULT_MAX_PER_RUN; i++) {
    var r = rows[i];
    if (String(r[3]).trim() !== 'email_gate') continue;       // only gate captures
    if (String(r[12] || '').trim() !== '') continue;          // result email already sent
    if (resultTrue_(r[8])) continue;                          // a non-deferred row already got an email
    var email = String(r[2]).trim();
    if (email.indexOf('@') === -1) continue;
    var ts = new Date(r[1]).getTime();
    if (!ts) continue;
    var age = now - ts;
    if (age < RESULT_DELAY_MS) continue;                      // not yet (still inside the 7-min window)
    if (age > RESULT_LOOKBACK_MS) continue;                   // too old, skip

    var subId = String(r[0]).trim();
    var sub = byId[subId];
    if (!sub) continue;                                       // no result data to show

    var d = {
      effectiveComp: sub.total > 0 ? sub.total : sub.base,
      totalComp:     sub.total > 0,
      role:          sub.role,
      yoe:           sub.yoe,
      city:          sub.city,
      percentile:    String(r[6] || '').trim(),
      surveyUrl:     resultSurveyLink_(String(r[7] || '').trim(), subId, email)
    };
    var msg = resultEmail_(d, sub.done);
    var rowNum = i + 1;

    processed++;
    if (RESULT_DRY_RUN) {
      Logger.log('[DRY] result email (' + (sub.done ? 'completed' : 'survey-cta') + ') -> ' + email);
      continue;
    }
    try {
      sendViaResend_({ to: email, subject: msg.subject, html: msg.html });
      emails.getRange(rowNum, 13).setValue(new Date().toISOString());
    } catch (e) {
      Logger.log('Result email failed for ' + email + ': ' + e.message);
    }
  }
  Logger.log('sendResultEmails processed ' + processed + (RESULT_DRY_RUN ? ' (dry run)' : ''));
}

function resultTrue_(v) {
  var t = String(v).trim().toLowerCase();
  return v === true || t === 'true' || t === 'yes';
}

function resultFormatEUR_(n) {
  var v = Math.round(Number(n) || 0);
  return '€' + String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function resultSurveyLink_(token, sid, email) {
  var url = RESULT_SURVEY_URL + '?survey=1';
  if (token) url += '&access=' + encodeURIComponent(token);
  if (sid)   url += '&sid=' + encodeURIComponent(sid);
  if (email) url += '&e=' + encodeURIComponent(email);
  return url;
}

function resultEmail_(d, completed) {
  var salaryLine = resultFormatEUR_(d.effectiveComp) + ' / year' +
    (d.totalComp ? ' <span style="font-size:.6em;font-weight:400;color:#7A7060;">(total comp included)</span>' : '');
  var ctx = [d.role, (d.yoe === '' || d.yoe === null || d.yoe === undefined ? null : (d.yoe + ' year' + (Number(d.yoe) === 1 ? '' : 's'))), d.city]
    .filter(function(x) { return x; }).join(' &middot; ');
  var position = d.percentile !== ''
    ? '<p style="margin:0 0 24px 0;font-size:17px;line-height:1.55;color:#2B2B2B;">You earn more than <strong>' + resultEscape_(d.percentile) + '%</strong> of PMs in the Portugal benchmark.</p>'
    : '';

  var tail = completed
    ? '<p style="margin:0 0 4px 0;font-size:17px;line-height:1.55;color:#2B2B2B;">Thanks for contributing your numbers.</p>' +
      '<p style="margin:0 0 0 0;font-size:17px;line-height:1.55;color:#2B2B2B;">The full dashboard unlocks for everyone once we reach <strong>' + RESULT_GOAL + '</strong> responses. We will email you the moment it is live.</p>'
    : '<p style="margin:0 0 24px 0;font-size:17px;line-height:1.55;color:#2B2B2B;">The full dashboard is still locked: best-paid industries and companies, the adjusted gender pay gap, remote vs office pay and the highest-paid PM skills. Complete the 2-minute survey to open it.</p>' +
      resultButton_('Complete the survey', d.surveyUrl) +
      '<p style="margin:28px 0 0 0;font-size:14px;line-height:1.55;color:#6B6B6B;">It is anonymous and takes about two minutes. Every answer makes the benchmark sharper for the whole Portuguese PM community.</p>';

  return {
    subject: completed ? 'Your Salary Compass result' : 'Your Salary Compass result, and what is still locked',
    html: resultWrap_(
      '<p style="margin:0 0 12px 0;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#7A7060;font-weight:700;">Product Salary Compass</p>' +
      '<h1 style="margin:0 0 8px 0;font-size:30px;line-height:1.1;letter-spacing:-0.03em;color:#161616;font-weight:800;">Here is your result.</h1>' +
      '<p style="margin:0 0 4px 0;font-size:28px;line-height:1.15;color:#161616;font-weight:800;">' + salaryLine + '</p>' +
      (ctx ? '<p style="margin:0 0 18px 0;font-size:15px;color:#6B6B6B;">' + ctx + '</p>' : '') +
      position +
      tail +
      '<p style="margin:24px 0 0 0;font-size:15px;color:#161616;">- Javi</p>'
    )
  };
}

function resultButton_(label, url) {
  return '<a href="' + resultEscape_(url) + '" style="display:inline-block;background-color:#FFC600;color:#161616;text-decoration:none;font-weight:700;font-size:16px;padding:14px 24px;border-radius:8px;">' + resultEscape_(label) + '</a>';
}

function resultWrap_(inner) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="margin:0;padding:0;background-color:#ECE7DC;font-family:Helvetica,Arial,sans-serif;color:#161616;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px;">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">' +
    '<tr><td style="padding:0 0 24px 0;font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:#161616;font-weight:bold;">The Impostor PM</td></tr>' +
    '<tr><td style="background-color:#FFF8E5;border-radius:14px;padding:36px 32px;">' + inner + '</td></tr>' +
    '<tr><td style="padding:24px 0 0 0;font-size:12px;line-height:1.5;color:#6B6B6B;text-align:center;">You are receiving this because you shared your email on the Product Salary Compass.<br>' +
    '<a href="mailto:general@impostor.pm?subject=Unsubscribe" style="color:#6B6B6B;">Unsubscribe</a> &middot; The Impostor PM</td></tr>' +
    '</table></td></tr></table></body></html>';
}

function resultEscape_(v) {
  return String(v || '').replace(/[<>"]/g, function(c){return {'<':'&lt;','>':'&gt;','"':'&quot;'}[c];});
}

/* Quick manual test: sends the survey-CTA version to your TEST_EMAIL. */
function testResultEmail() {
  var to = PropertiesService.getScriptProperties().getProperty('TEST_EMAIL') || Session.getActiveUser().getEmail();
  if (!to) throw new Error('Set TEST_EMAIL in Script Properties first');
  var msg = resultEmail_({ effectiveComp: 62000, totalComp: true, role: 'Senior PM', yoe: 6, city: 'Lisboa', percentile: '68', surveyUrl: resultSurveyLink_('tok', 'sid', to) }, false);
  sendViaResend_({ to: to, subject: msg.subject, html: msg.html });
  Logger.log('Sent test result email to ' + to);
}

/* ════════════════════════════════════════════════════════════════════
 *  REQUIRED Code.gs EDIT (one line, apply by hand in the web editor)
 *
 *  Allow the email_gate source so gate captures keep their source tag (the
 *  client already marks the row as "email handled by API / not sent", so no
 *  send-skipping edit is needed). In cleanEmailSource_, add |email_gate to the
 *  allow-list regex:
 *
 *    BEFORE:
 *      return /^(dashboard_waitlist|survey_inline|newsletter_popup|footer_newsletter)$/
 *        .test(source) ? source : 'dashboard_waitlist';
 *    AFTER:
 *      return /^(dashboard_waitlist|survey_inline|newsletter_popup|footer_newsletter|email_gate)$/
 *        .test(source) ? source : 'dashboard_waitlist';
 *
 *  (This same edit is also what makes the survey reminders work.)
 * ════════════════════════════════════════════════════════════════════ */
