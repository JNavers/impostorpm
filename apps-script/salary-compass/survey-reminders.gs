/* ════════════════════════════════════════════════════════════════════
 *  SURVEY REMINDERS  —  paste into the LIVE Apps Script (web editor).
 *
 *  Nudges users who were captured by the email gate, opted in, and have
 *  NOT completed the full survey. Two emails: ~24h and ~72h after capture,
 *  then it stops. Reuses the existing sendViaResend_() helper.
 *
 *  ─ ONE-TIME SETUP ─────────────────────────────────────────────────
 *   1) Emails sheet → add two headers in row 1:
 *        K1 = "Reminder 1 Sent"   L1 = "Reminder 2 Sent"
 *   2) Triggers (clock icon) → Add Trigger:
 *        function = sendSurveyReminders | Time-driven | Hour timer | every hour
 *   3) Script Properties → SALARY_COMPASS_FROM_EMAIL =
 *        "Javi from Impostor PM <general@impostor.pm>"
 *
 *  Set REMINDER_DRY_RUN = true first → it only LOGS who would be emailed.
 * ════════════════════════════════════════════════════════════════════ */

var REMINDER_DRY_RUN      = true;                       // flip to false to actually send
var REMINDER_1_AFTER_MS   = 24 * 60 * 60 * 1000;        // 24h
var REMINDER_2_AFTER_MS   = 72 * 60 * 60 * 1000;        // 72h
var REMINDER_MAX_PER_RUN  = 80;                         // safety cap per hourly run
var REMINDER_SURVEY_URL   = 'https://www.impostor.pm/salary-compass/';

function sendSurveyReminders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var emails = ss.getSheetByName('Emails');
  var subs   = ss.getSheetByName('Submissions');
  if (!emails || !subs) throw new Error('Emails/Submissions sheet not found');

  // Submission IDs that completed the full survey (Submissions col 21 "Full Survey" = "Yes").
  var sv = subs.getDataRange().getValues();
  var completed = {};
  for (var s = 1; s < sv.length; s++) {
    if (String(sv[s][20]).trim().toLowerCase() === 'yes') {
      completed[String(sv[s][0]).trim()] = true;
    }
  }

  // Emails columns (1-indexed): 1 Submission ID, 2 Timestamp, 3 Email, 4 Source,
  // 5 Report Opt-in, 6 Newsletter Opt-in, 7 Percentile, 8 Token, 9 Email Sent,
  // 10 Email Error, 11 Reminder 1 Sent, 12 Reminder 2 Sent
  var rows = emails.getDataRange().getValues();
  var now = Date.now();
  var processed = 0;

  for (var i = 1; i < rows.length && processed < REMINDER_MAX_PER_RUN; i++) {
    var r = rows[i];
    if (String(r[3]).trim() !== 'email_gate') continue;             // only gate captures
    if (!(reminderTrue_(r[4]) || reminderTrue_(r[5]))) continue;    // opted in (report OR newsletter)
    var subId = String(r[0]).trim();
    if (completed[subId]) continue;                                 // already did the survey
    var email = String(r[2]).trim();
    if (email.indexOf('@') === -1) continue;
    var ts = new Date(r[1]).getTime();
    if (!ts) continue;

    var age   = now - ts;
    var token = String(r[7] || '').trim();
    var did1  = String(r[10] || '').trim() !== '';
    var did2  = String(r[11] || '').trim() !== '';
    var rowNum = i + 1;

    var msg = null, col = 0;
    if (!did1 && age >= REMINDER_1_AFTER_MS)          { msg = reminderEmail1_(token, subId, email); col = 11; }
    else if (did1 && !did2 && age >= REMINDER_2_AFTER_MS) { msg = reminderEmail2_(token, subId, email); col = 12; }
    if (!msg) continue;

    processed++;
    if (REMINDER_DRY_RUN) {
      Logger.log('[DRY] reminder ' + (col === 11 ? '1' : '2') + ' -> ' + email);
      continue;
    }
    try {
      sendViaResend_({ to: email, subject: msg.subject, html: msg.html });
      emails.getRange(rowNum, col).setValue(new Date().toISOString());
    } catch (e) {
      Logger.log('Reminder failed for ' + email + ': ' + e.message);
    }
  }
  Logger.log('sendSurveyReminders processed ' + processed + (REMINDER_DRY_RUN ? ' (dry run)' : ''));
}

function reminderTrue_(v) {
  var t = String(v).trim().toLowerCase();
  return v === true || t === 'true' || t === 'yes';
}

function reminderSurveyLink_(token, sid, email) {
  var url = REMINDER_SURVEY_URL + '?survey=1';
  if (token) url += '&access=' + encodeURIComponent(token);
  if (sid)   url += '&sid=' + encodeURIComponent(sid);
  if (email) url += '&e=' + encodeURIComponent(email);
  return url;
}

function reminderEmail1_(token, sid, email) {
  var url = reminderSurveyLink_(token, sid, email);
  return {
    subject: 'You saw your number. The benchmark is still locked.',
    html: reminderWrap_(
      '<p style="margin:0 0 12px 0;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#7A7060;font-weight:700;">Product Salary Compass</p>' +
      '<h1 style="margin:0 0 20px 0;font-size:30px;line-height:1.1;letter-spacing:-0.03em;color:#161616;font-weight:800;">Your benchmark is half-unlocked.</h1>' +
      '<p style="margin:0 0 18px 0;font-size:17px;line-height:1.55;color:#2B2B2B;">You just checked where your salary stands against the Portugal PM benchmark. That is the headline number, but the full picture is still locked.</p>' +
      '<p style="margin:0 0 10px 0;font-size:17px;line-height:1.55;color:#2B2B2B;">Complete the 2-minute survey and you unlock:</p>' +
      '<ul style="margin:0 0 24px 0;padding-left:20px;font-size:17px;line-height:1.7;color:#2B2B2B;">' +
        '<li>Best-paid industries and companies</li>' +
        '<li>The adjusted gender pay gap (same role, level and experience)</li>' +
        '<li>Remote vs office pay</li>' +
        '<li>The highest-paid PM skills</li>' +
      '</ul>' +
      reminderButton_('Complete the survey', url) +
      '<p style="margin:28px 0 0 0;font-size:14px;line-height:1.55;color:#6B6B6B;">It is anonymous and takes about two minutes. Every answer makes the benchmark sharper for the whole Portuguese PM community.</p>' +
      '<p style="margin:24px 0 0 0;font-size:15px;color:#161616;">- Javi</p>'
    )
  };
}

function reminderEmail2_(token, sid, email) {
  var url = reminderSurveyLink_(token, sid, email);
  return {
    subject: 'The Portugal PM dashboard is almost ready',
    html: reminderWrap_(
      '<p style="margin:0 0 12px 0;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#7A7060;font-weight:700;">Product Salary Compass</p>' +
      '<h1 style="margin:0 0 20px 0;font-size:30px;line-height:1.1;letter-spacing:-0.03em;color:#161616;font-weight:800;">One last nudge.</h1>' +
      '<p style="margin:0 0 18px 0;font-size:17px;line-height:1.55;color:#2B2B2B;">Your Salary Compass result is saved, but the full dashboard is still locked.</p>' +
      '<p style="margin:0 0 24px 0;font-size:17px;line-height:1.55;color:#2B2B2B;">The full benchmark, with industries, the adjusted gender pay gap, remote vs office pay and the highest-paid skills, opens once enough of us contribute. If you have two minutes, add yours.</p>' +
      reminderButton_('Complete the survey', url) +
      '<p style="margin:28px 0 0 0;font-size:14px;line-height:1.55;color:#6B6B6B;">If now is not the time, no problem. This is the last reminder.</p>' +
      '<p style="margin:24px 0 0 0;font-size:15px;color:#161616;">- Javi</p>'
    )
  };
}

function reminderButton_(label, url) {
  return '<a href="' + reminderEscape_(url) + '" style="display:inline-block;background-color:#FFC600;color:#161616;text-decoration:none;font-weight:700;font-size:16px;padding:14px 24px;border-radius:8px;">' + reminderEscape_(label) + '</a>';
}

function reminderWrap_(inner) {
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

function reminderEscape_(v) {
  return String(v || '').replace(/[&<>"']/g, function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});
}

/* Quick manual test from the editor: sends reminder 1 to your TEST_EMAIL. */
function testSurveyReminderEmail() {
  var to = PropertiesService.getScriptProperties().getProperty('TEST_EMAIL') || Session.getActiveUser().getEmail();
  if (!to) throw new Error('Set TEST_EMAIL in Script Properties first');
  var msg = reminderEmail1_('test-token', 'test-sid', to);
  sendViaResend_({ to: to, subject: msg.subject, html: msg.html });
  Logger.log('Sent test reminder to ' + to);
}
