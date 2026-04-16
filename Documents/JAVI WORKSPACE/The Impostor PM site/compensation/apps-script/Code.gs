/* ── POST: Create or update submissions ── */
function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Submissions');
  var emailSheet = ss.getSheetByName('Emails');

  // Create Emails tab if it doesn't exist
  if (!emailSheet) {
    emailSheet = ss.insertSheet('Emails');
    emailSheet.appendRow(['ID', 'Timestamp', 'Email']);
  }

  var data = JSON.parse(e.postData.contents);

  if (data.action === 'update') {
    var ids = sheet.getRange('A:A').getValues();
    for (var i = 0; i < ids.length; i++) {
      if (ids[i][0] === data.id) {
        var row = i + 1;
        sheet.getRange(row, 9).setValue(data.gender);
        sheet.getRange(row, 10).setValue(data.company);
        sheet.getRange(row, 11).setValue(data.industry);
        sheet.getRange(row, 12).setValue(data.orgSize);
        sheet.getRange(row, 13).setValue(data.companyType);
        sheet.getRange(row, 14).setValue(data.remotePolicy);
        sheet.getRange(row, 15).setValue(data.companyLocation);
        sheet.getRange(row, 16).setValue(data.employment);
        sheet.getRange(row, 17).setValue(data.perks);
        sheet.getRange(row, 18).setValue(data.transparency);
        sheet.getRange(row, 19).setValue(data.salaryAdequacy);
        sheet.getRange(row, 20).setValue(data.negotiationComfort);
        sheet.getRange(row, 21).setValue('Yes');
        break;
      }
    }
    // Save email to separate sheet
    if (data.email) {
      emailSheet.appendRow([data.id, new Date().toISOString(), data.email]);
    }
  } else {
    sheet.appendRow([
      data.id,
      new Date().toISOString(),
      data.baseSalary,
      data.totalComp || '',
      data.role,
      data.yoe,
      data.city,
      data.perceptionGuess,
      '', '', '', '', '', '', '', '', '', '', '', '', 'No'
    ]);
  }

  return ContentService.createTextOutput(JSON.stringify({status: 'ok'}))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ── GET: Compute and return live percentiles ── */
function doGet(e) {
  var result = computePercentiles();
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function computePercentiles() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var entries = [];

  /* ── Read Historical tab ── */
  var hist = ss.getSheetByName('Historical');
  if (!hist) {
    Logger.log('WARNING: "Historical" sheet not found. Skipping historical data.');
  } else {
    var hData = hist.getDataRange().getValues();
    var hHeaders = hData[0];

    /* Tolerant header matching: normalize (lowercase, strip punctuation/whitespace)
       so minor edits to the source header don't silently drop the column. */
    var hCol = {};
    for (var i = 0; i < hHeaders.length; i++) {
      var norm = normalizeHeader(hHeaders[i]);
      if (norm === 'wheredoyoureside') hCol.country = i;
      else if (norm.indexOf('beforetaxes') >= 0 && norm.indexOf('withoutperks') >= 0) hCol.base = i;
      else if (norm.indexOf('beforetaxes') >= 0 && norm.indexOf('withperks') >= 0 && norm.indexOf('without') < 0) hCol.total = i;
      else if (norm === 'role') hCol.role = i;
      else if (norm.indexOf('howmanyyearsofexperience') >= 0 && norm.indexOf('product') >= 0) hCol.yoe = i;
      else if (norm === 'outlier') hCol.outlier = i;
    }

    Logger.log('Resolved Historical columns: ' + JSON.stringify(hCol));
    Logger.log('All headers: ' + JSON.stringify(hHeaders.map(function(h, idx) { return idx + '=' + String(h).substring(0, 40); })));
    if (hCol.country === undefined || hCol.base === undefined || hCol.role === undefined || hCol.yoe === undefined) {
      Logger.log('WARNING: Historical headers not recognized — missing critical columns.');
    } else {
      for (var r = 1; r < hData.length; r++) {
        var row = hData[r];
        if (String(row[hCol.country]).trim() !== 'Portugal') continue;
        if (hCol.outlier !== undefined && String(row[hCol.outlier]).trim().toUpperCase() === 'TRUE') continue;

        var base = parseSalary(row[hCol.base]);
        var total = hCol.total !== undefined ? parseSalary(row[hCol.total]) : 0;
        var role = mapHistoricalRole(String(row[hCol.role]).trim());
        var yoe = yoeToBucket(row[hCol.yoe]);

        if (base > 0 && yoe) {
          entries.push({ base: base, total: total > 0 ? total : base, role: role, yoe: yoe });
        }
      }
    }
  }

  /* ── Read Submissions tab ── */
  var sub = ss.getSheetByName('Submissions');
  if (sub && sub.getLastRow() > 1) {
    var sData = sub.getDataRange().getValues();
    for (var r = 1; r < sData.length; r++) {
      var row = sData[r];
      var base = parseSalary(row[2]);
      var total = parseSalary(row[3]);
      var role = mapSubmissionRole(String(row[4]).trim());
      var yoe = yoeToBucket(row[5]);

      if (base > 0 && yoe) {
        entries.push({ base: base, total: total > 0 ? total : base, role: role, yoe: yoe });
      }
    }
  }

  /* ── Compute percentiles ── */
  var roleOrder = ['APM', 'PM', 'Senior PM', 'Lead/Principal', 'Director+', 'VP/Head/CPO'];
  var yoeOrder = ['0-1', '1-3', '3-5', '6-8', '9-12', '13+'];

  var allBase = entries.map(function(e) { return e.base; });
  var allTotal = entries.map(function(e) { return e.total; });

  var result = {
    overall: pcts(allBase),
    roles: {},
    yoe: {},
    totalComp: {
      overall: pcts(allTotal),
      roles: {},
      yoe: {}
    },
    totalEntries: entries.length
  };

  for (var i = 0; i < roleOrder.length; i++) {
    var role = roleOrder[i];
    var baseVals = entries.filter(function(e) { return e.role === role; }).map(function(e) { return e.base; });
    var totalVals = entries.filter(function(e) { return e.role === role; }).map(function(e) { return e.total; });
    result.roles[role] = pcts(baseVals);
    result.totalComp.roles[role] = pcts(totalVals);
  }

  for (var i = 0; i < yoeOrder.length; i++) {
    var yoe = yoeOrder[i];
    var baseVals = entries.filter(function(e) { return e.yoe === yoe; }).map(function(e) { return e.base; });
    var totalVals = entries.filter(function(e) { return e.yoe === yoe; }).map(function(e) { return e.total; });
    result.yoe[yoe] = pcts(baseVals);
    result.totalComp.yoe[yoe] = pcts(totalVals);
  }

  return result;
}

/* ── Helpers ── */

function normalizeHeader(val) {
  return String(val || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseSalary(val) {
  if (!val) return 0;
  var s = String(val).replace(/[\s\u00A0,]/g, '').trim();
  var n = parseInt(s);
  return isNaN(n) ? 0 : n;
}

function pcts(arr) {
  arr = arr.filter(function(v) { return v > 0; });
  if (arr.length < 3) return { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, n: arr.length };
  arr.sort(function(a, b) { return a - b; });
  return {
    p10: percentile(arr, 10),
    p25: percentile(arr, 25),
    p50: percentile(arr, 50),
    p75: percentile(arr, 75),
    p90: percentile(arr, 90),
    n: arr.length
  };
}

function percentile(sortedArr, p) {
  var k = (sortedArr.length - 1) * p / 100;
  var f = Math.floor(k);
  var c = Math.ceil(k);
  if (f === c) return sortedArr[f];
  return Math.round(sortedArr[f] + (k - f) * (sortedArr[c] - sortedArr[f]));
}

function mapHistoricalRole(role) {
  var map = {
    '01-Associate/Junior Product Manager': 'APM',
    '02-Mid Product Manager': 'PM',
    '03-Senior Product Manager': 'Senior PM',
    '04-Principal Product Manager': 'Lead/Principal',
    '05-Lead/Group Product Manager': 'Lead/Principal',
    '06-Head of Product': 'Director+',
    '07-Associate Director of Product Management': 'Director+',
    '08-Director of Product Management': 'Director+',
    '09-Senior Director of Product Management': 'Director+',
    '10-VP of Product Management': 'VP/Head/CPO',
    '12-Chief Product Officer': 'VP/Head/CPO'
  };
  return map[role] || null;
}

function mapSubmissionRole(role) {
  var map = {
    'APM': 'APM',
    'PM': 'PM',
    'Senior PM': 'Senior PM',
    'Lead PM': 'Lead/Principal',
    'Principal PM': 'Lead/Principal',
    'Director of Product': 'Director+',
    'Head of Product': 'Director+',
    'VP of Product': 'VP/Head/CPO',
    'CPO': 'VP/Head/CPO'
  };
  return map[role] || null;
}

/* ── YoE bucketing (NEW buckets: 0-1, 1-3, 3-5, 6-8, 9-12, 13+) ──
 * Accepts numeric years OR legacy string buckets ("0-2", "3-5", …).
 * Legacy "0-2" maps to midpoint (1) → bucket "1-3".
 * Returns null for unparseable values (row will be ignored).
 */
function yoeToBucket(val) {
  if (val === null || val === undefined || val === '') return null;

  // Handle native number
  if (typeof val === 'number' && !isNaN(val)) {
    return numToBucket(val);
  }

  var s = String(val).trim();
  if (s === '') return null;

  // Legacy string buckets → midpoint
  var legacyMidpoint = {
    '0-2': 1,
    '3-5': 4,
    '6-8': 7,
    '9-12': 10,
    '13+': 14
  };
  if (legacyMidpoint.hasOwnProperty(s)) {
    return numToBucket(legacyMidpoint[s]);
  }

  // Numeric string (supports decimals, e.g. "1.5")
  var y = parseFloat(s.replace(',', '.'));
  if (isNaN(y)) return null;
  return numToBucket(y);
}

function numToBucket(y) {
  if (y < 0) return null;
  if (y <= 1) return '0-1';
  if (y <= 3) return '1-3';
  if (y <= 5) return '3-5';
  if (y <= 8) return '6-8';
  if (y <= 12) return '9-12';
  return '13+';
}
