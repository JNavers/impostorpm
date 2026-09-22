/* ════════════════════════════════════════════════════════════════════
 *  SURVEY LINK  —  paste into the LIVE Apps Script (web editor) as a new
 *  file named survey-link.gs. Needs survey-reminders.gs in the same project
 *  (it reuses reminderSurveyLink_ so the link is exactly the one the emails send).
 *
 *  Adds a "Salary Compass" menu to the Sheet. "Survey link for an email…"
 *  asks for an email and shows the personal survey link for that person's
 *  comparison, ready to copy and send by hand.
 *
 *  The link reopens the survey bound to the comparison they already made, so
 *  the answers enrich that row instead of creating a second one. There is no
 *  link for someone who never compared: there is nothing to attach it to.
 *
 *  ─ ONE-TIME SETUP ─────────────────────────────────────────────────
 *   Paste, save, then reload the Sheet. The menu appears after a few seconds.
 *   The first use asks for authorisation (the script already has it for the
 *   Sheet; this adds the dialog).
 *
 *  Only people who can edit the Sheet see the menu. The link carries the
 *  person's email and dashboard token: send it to that person only.
 * ════════════════════════════════════════════════════════════════════ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Salary Compass')
    .addItem('Survey link for an email…', 'showSurveyLinkPrompt')
    .addToUi();
}

function showSurveyLinkPrompt() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.prompt('Survey link', 'Email of the person (as they entered it on the Compass):', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var emails = ss.getSheetByName('Emails');
  var subs = ss.getSheetByName('Submissions');
  if (!emails || !subs) throw new Error('Emails/Submissions sheet not found');

  var found = surveyLinkLookup_(
    emails.getDataRange().getValues(),
    subs.getDataRange().getValues(),
    answer.getResponseText()
  );

  if (!found.ok) {
    ui.alert('No link for this email', found.message, ui.ButtonSet.OK);
    return;
  }

  var html = HtmlService.createHtmlOutput(surveyLinkDialogHtml_(found))
    .setWidth(520).setHeight(found.alreadyCompleted ? 330 : 290);
  ui.showModalDialog(html, 'Survey link');
}

/**
 * Pure lookup, so it can be tested outside Apps Script.
 *
 *  emailRows — Emails tab: 1 Submission ID, 2 Timestamp, 3 Email, 4 Source,
 *              5 Report Opt-in, 6 Newsletter Opt-in, 7 Percentile, 8 Token …
 *  subRows   — Submissions tab: 1 ID, 2 Timestamp, 3 Base, 4 Total, 5 Role,
 *              6 YoE, 7 District … 21 Full Survey
 *
 * Picks the most recent comparison that email is linked to. An email row with
 * no submission id (newsletter pop-up, footer) or pointing at an id that is
 * not in Submissions gives no link: the survey would have nothing to attach to.
 */
function surveyLinkLookup_(emailRows, subRows, rawEmail) {
  var email = String(rawEmail || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, message: 'That does not look like an email address.' };
  }

  var subsById = {};
  for (var s = 1; s < subRows.length; s++) {
    var sid = String(subRows[s][0] || '').trim();
    // First row wins: comparing again on the same page reuses the id, and
    // updateSubmission_ writes the survey to the FIRST row with it.
    if (!sid || subsById[sid]) continue;
    subsById[sid] = {
      createdAt: subRows[s][1],
      role: String(subRows[s][4] || '').trim(),
      district: String(subRows[s][6] || '').trim(),
      completed: String(subRows[s][20] || '').trim().toLowerCase() === 'yes'
    };
  }

  var matches = 0;
  var candidates = [];
  for (var i = 1; i < emailRows.length; i++) {
    var r = emailRows[i];
    if (String(r[2] || '').trim().toLowerCase() !== email) continue;
    matches++;
    var id = String(r[0] || '').trim();
    if (!id || !subsById[id]) continue;
    candidates.push({ id: id, token: String(r[7] || '').trim(), sub: subsById[id] });
  }

  if (!matches) {
    return { ok: false, message: 'No row in the Emails tab has ' + email + '. Check the spelling, or they may never have left an email.' };
  }
  if (!candidates.length) {
    return {
      ok: false,
      message: email + ' is in the Emails tab, but not linked to any comparison (for example, a newsletter sign-up). ' +
        'There is nothing for the survey to attach to: they need to compare their salary first.'
    };
  }

  // Newest comparison first. Distinct ids only: the same comparison can have
  // several email rows (gate, then the survey's own email step).
  candidates.sort(function(a, b) { return surveyLinkTime_(b.sub.createdAt) - surveyLinkTime_(a.sub.createdAt); });
  var distinct = {};
  candidates.forEach(function(c) { distinct[c.id] = true; });
  var best = candidates[0];
  // Prefer a row of that comparison that carries a token (it restores their dashboard).
  for (var k = 0; k < candidates.length; k++) {
    if (candidates[k].id === best.id && candidates[k].token) { best = candidates[k]; break; }
  }

  return {
    ok: true,
    email: email,
    link: reminderSurveyLink_(best.token, best.id, email),
    submissionId: best.id,
    comparedAt: best.sub.createdAt,
    role: best.sub.role,
    district: best.sub.district,
    alreadyCompleted: best.sub.completed,
    comparisons: Object.keys(distinct).length
  };
}

function surveyLinkTime_(v) {
  var t = (v instanceof Date) ? v.getTime() : new Date(v).getTime();
  return isNaN(t) ? 0 : t;
}

function surveyLinkDialogHtml_(f) {
  var when = f.comparedAt ? Utilities.formatDate(new Date(f.comparedAt), 'Europe/Lisbon', 'd MMM yyyy, HH:mm') : 'unknown date';
  var notes = [];
  if (f.alreadyCompleted) {
    notes.push('<p style="background:#fff8e1;border:1px solid #FFC600;border-radius:6px;padding:8px 10px;">' +
      '<b>They already completed the survey.</b> If they open it again, the new answers update the same row. Nothing is duplicated.</p>');
  }
  if (f.comparisons > 1) {
    notes.push('<p style="color:#6B6B6B;">This email is linked to ' + f.comparisons + ' comparisons; this is the most recent.</p>');
  }
  return '<div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#161616;line-height:1.45;">' +
    '<p style="margin-top:0;"><b>' + reminderEscape_(f.email) + '</b><br>' +
    'Comparison: ' + reminderEscape_(f.role || '?') + (f.district ? ', ' + reminderEscape_(f.district) : '') + ' · ' + reminderEscape_(when) + '</p>' +
    notes.join('') +
    '<input id="l" readonly value="' + reminderEscape_(f.link) + '" style="width:100%;box-sizing:border-box;padding:8px;font-size:12px;border:1px solid #ccc;border-radius:6px;" onclick="this.select()">' +
    '<p style="margin:12px 0 0;"><button onclick="var i=document.getElementById(\'l\');i.select();document.execCommand(\'copy\');this.textContent=\'Copied\';" ' +
    'style="background:#FFC600;border:0;border-radius:6px;padding:8px 16px;font-weight:bold;cursor:pointer;">Copy link</button></p>' +
    '<p style="color:#6B6B6B;margin-bottom:0;">Personal link: it carries their email and dashboard access. Send it to this person only.</p>' +
    '</div>';
}
