var COMP_PERCENTILES_CACHE_KEY = 'comp_percentiles_v2';
var COMP_COUNTS_CACHE_KEY = 'comp_counts_v2';
var MAX_POST_BYTES = 12000;
var MIN_PUBLIC_BUCKET_N = 5;
var MIN_PUBLIC_DISTRICT_N = 10;

var ALLOWED_ROLES = {
  'APM': true,
  'PM': true,
  'Senior PM': true,
  'Lead PM': true,
  'Principal PM': true,
  'Director of Product': true,
  'Head of Product': true,
  'VP of Product': true,
  'CPO': true
};

var ALLOWED_DISTRICTS = {
  'Aveiro': true,
  'Beja': true,
  'Braga': true,
  'Bragança': true,
  'Castelo Branco': true,
  'Coimbra': true,
  'Évora': true,
  'Faro': true,
  'Guarda': true,
  'Leiria': true,
  'Lisboa': true,
  'Portalegre': true,
  'Porto': true,
  'Santarém': true,
  'Setúbal': true,
  'Viana do Castelo': true,
  'Vila Real': true,
  'Viseu': true,
  'Açores': true,
  'Madeira': true
};

/* ── POST: Create or update submissions ── */
function doPost(e) {
  var lock;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Submissions');
    if (!sheet) throw new Error('Submissions sheet not found');
    var emailSheet = getOrCreateEmailSheet_(ss);
    var data = parsePostData_(e);
    var action = cleanAction_(data.action);

    lock = LockService.getScriptLock();
    lock.waitLock(5000);

    if (action === 'email_only') {
      var emailOnlyResult = saveEmailOnly_(ss, data);
      return json_(emailOnlyResult);
    }

    if (action === 'create') {
      createSubmission_(sheet, data);
      clearPublicCaches_();
      return json_({ status: 'ok' });
    }

    if (action === 'update') {
      var updated = updateSubmission_(sheet, emailSheet, data);
      clearPublicCaches_();
      return json_({ status: 'ok', updated: updated });
    }

    return json_({ status: 'error', message: 'Unsupported action' });
  } catch (err) {
    Logger.log('doPost error: ' + err.message);
    return json_({ status: 'error', message: 'Invalid request' });
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch (releaseErr) {}
    }
  }
}

/* ── GET: Compute and return live percentiles ── */
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'count') {
    var countResult = getCachedCounts_();
    return json_(countResult);
  }

  if (e && e.parameter && e.parameter.action) {
    return json_({ status: 'error', message: 'Unsupported action' });
  }

  var cache = CacheService.getScriptCache();
  var cachedJson = cache.get(COMP_PERCENTILES_CACHE_KEY);
  if (cachedJson) {
    return ContentService.createTextOutput(cachedJson)
      .setMimeType(ContentService.MimeType.JSON);
  }

  var result = computePercentiles();
  var resultJson = JSON.stringify(result);
  cache.put(COMP_PERCENTILES_CACHE_KEY, resultJson, 300);
  return json_(result);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function parsePostData_(e) {
  if (!e || !e.postData || !e.postData.contents) throw new Error('Missing body');
  if (e.postData.contents.length > MAX_POST_BYTES) throw new Error('Body too large');
  var data = JSON.parse(e.postData.contents);
  if (!data || typeof data !== 'object') throw new Error('Body must be an object');
  return data;
}

function cleanAction_(value) {
  var action = String(value || '').trim();
  return /^(create|update|email_only)$/.test(action) ? action : '';
}

function cleanId_(value) {
  var id = cleanToken_(value, 80);
  if (!/^[a-zA-Z0-9._-]{8,80}$/.test(id)) throw new Error('Invalid id');
  return id;
}

function cleanToken_(value, maxLen) {
  return String(value || '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, maxLen || 100);
}

function cleanText_(value, maxLen) {
  var s = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen || 120);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function cleanEnum_(value, allowed) {
  var s = cleanText_(value, 80);
  return allowed[s] ? s : '';
}

function cleanEmail_(value) {
  var email = String(value || '').trim().toLowerCase().slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email');
  return email;
}

function cleanMoney_(value, min, max) {
  if (value === null || value === undefined || value === '') return '';
  var n = parseSalary(value);
  if (!isFinite(n) || n < min || n > max) throw new Error('Invalid money value');
  return n;
}

function cleanNumber_(value, min, max) {
  if (value === null || value === undefined || value === '') return '';
  var n = Number(value);
  if (!isFinite(n) || n < min || n > max) throw new Error('Invalid number value');
  return n;
}

function cleanBoolString_(value) {
  return String(value || '').toLowerCase() === 'true' ? 'true' : 'false';
}

function getOrCreateEmailSheet_(ss) {
  var emailSheet = ss.getSheetByName('Emails');
  if (!emailSheet) {
    emailSheet = ss.insertSheet('Emails');
    emailSheet.appendRow(['Timestamp', 'Email', 'Source', 'Dashboard Opt-in', 'Newsletter Opt-in', 'Percentile', 'Token']);
  }
  return emailSheet;
}

function clearPublicCaches_() {
  CacheService.getScriptCache().removeAll([
    COMP_COUNTS_CACHE_KEY,
    COMP_PERCENTILES_CACHE_KEY,
    'comp_counts_v1',
    'comp_percentiles_v1'
  ]);
}

function createSubmission_(sheet, data) {
  var id = cleanId_(data.id);
  var baseSalary = cleanMoney_(data.baseSalary, 1, 1000000);
  var totalComp = data.totalComp === '' || data.totalComp === null || data.totalComp === undefined
    ? ''
    : cleanMoney_(data.totalComp, baseSalary, 1500000);
  var role = cleanEnum_(data.role, ALLOWED_ROLES);
  var yoe = cleanNumber_(data.yoe, 0, 50);
  var city = cleanEnum_(data.city, ALLOWED_DISTRICTS);
  var perceptionGuess = cleanNumber_(data.perceptionGuess, 0, 100);

  if (!role || yoe === '' || !city) throw new Error('Invalid create payload');

  sheet.appendRow([
    id,
    new Date().toISOString(),
    baseSalary,
    totalComp,
    role,
    yoe,
    city,
    perceptionGuess,
    '', '', '', '', '', '', '', '', '', '', '', '', 'No'
  ]);
}

function updateSubmission_(sheet, emailSheet, data) {
  var id = cleanId_(data.id);
  var ids = sheet.getRange('A:A').getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) {
      var row = i + 1;
      sheet.getRange(row, 9).setValue(cleanText_(data.gender, 40));
      sheet.getRange(row, 10).setValue(cleanText_(data.company, 120));
      sheet.getRange(row, 11).setValue(cleanText_(data.industry, 80));
      sheet.getRange(row, 12).setValue(cleanText_(data.orgSize, 40));
      sheet.getRange(row, 13).setValue(cleanText_(data.companyType, 80));
      sheet.getRange(row, 14).setValue(cleanText_(data.remotePolicy, 80));
      sheet.getRange(row, 15).setValue(cleanText_(data.companyLocation, 80));
      sheet.getRange(row, 16).setValue(cleanText_(data.employment, 80));
      sheet.getRange(row, 17).setValue(cleanText_(data.perks, 500));
      sheet.getRange(row, 18).setValue(cleanNumber_(data.transparency, 1, 5));
      sheet.getRange(row, 19).setValue(cleanNumber_(data.salaryAdequacy, 1, 5));
      sheet.getRange(row, 20).setValue(cleanNumber_(data.negotiationComfort, 1, 5));
      sheet.getRange(row, 21).setValue('Yes');
      if (data.dashboardToken) {
        sheet.getRange(row, 22).setValue(cleanToken_(data.dashboardToken, 100));
      }
      sheet.getRange(row, 23).setValue(cleanMoney_(data.bonus, 0, 1000000));
      sheet.getRange(row, 24).setValue(cleanMoney_(data.equityGrant, 0, 1000000));
      sheet.getRange(row, 25).setValue(cleanMoney_(data.fullSurveyTotalComp, 0, 1500000));
      sheet.getRange(row, 26).setValue(cleanText_(data.currency || 'EUR', 10));
      sheet.getRange(row, 27).setValue(cleanText_(data.hasEquity, 20));
      sheet.getRange(row, 28).setValue(cleanMoney_(data.perksValue, 0, 1000000));
      sheet.getRange(row, 29).setValue(cleanText_(data.seniority, 80));
      sheet.getRange(row, 30).setValue(cleanNumber_(data.yearsCurrentRole, 0, 50));
      sheet.getRange(row, 31).setValue(cleanText_(data.topSkills, 300));
      sheet.getRange(row, 33).setValue(cleanText_(data.companyTypeOther, 100));
      sheet.getRange(row, 34).setValue(cleanText_(data.industryOther, 100));
      sheet.getRange(row, 35).setValue(cleanNumber_(data.hybridDays, 0, 31));
      sheet.getRange(row, 36).setValue(cleanText_(data.hybridDaysFrequency, 20));
      sheet.getRange(row, 37).setValue(cleanText_(data.companyLocationOther, 100));
      sheet.getRange(row, 38).setValue(cleanText_(data.officeInCountry, 10));
      sheet.getRange(row, 39).setValue(cleanText_(data.employmentOther, 100));
      sheet.getRange(row, 40).setValue(cleanMoney_(data.perkWellness, 0, 100000));
      sheet.getRange(row, 41).setValue(cleanMoney_(data.perkHomeOffice, 0, 100000));
      sheet.getRange(row, 42).setValue(cleanMoney_(data.perkLearning, 0, 100000));
      sheet.getRange(row, 43).setValue(cleanMoney_(data.perkMeal, 0, 1000));
      sheet.getRange(row, 44).setValue(cleanMoney_(data.perkPension, 0, 200000));

      if (data.email) {
        emailSheet.appendRow([id, new Date().toISOString(), cleanEmail_(data.email)]);
      }
      return true;
    }
  }
  return false;
}

/* ── SETUP: Write column headers to row 1 of the Submissions sheet ──
 * Run manually from the Apps Script editor after schema changes.
 * Headers reflect the current survey + create/update payload (44 columns).
 * Column 32 is reserved (was used by a previous schema and is no longer written).
 */
function setupSubmissionsHeaders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Submissions');
  if (!sheet) throw new Error('Submissions sheet not found');

  var headers = [
    'ID',                       // 1
    'Timestamp',                // 2
    'Base Salary',              // 3
    'Total Comp',               // 4
    'Role',                     // 5
    'YoE',                      // 6
    'City',                     // 7
    'Perception Guess',         // 8
    'Gender',                   // 9
    'Company',                  // 10
    'Industry',                 // 11
    'Org Size',                 // 12
    'Company Type',             // 13
    'Remote Policy',            // 14
    'Company Location',         // 15
    'Employment',               // 16
    'Perks',                    // 17
    'Transparency',             // 18
    'Salary Adequacy',          // 19
    'Negotiation Comfort',      // 20
    'Full Survey',              // 21
    'Dashboard Token',          // 22
    'Bonus',                    // 23
    'Equity Grant',             // 24
    'Full Survey Total Comp',   // 25
    'Currency',                 // 26
    'Has Equity',               // 27
    'Perks Value',              // 28
    'Seniority',                // 29
    'Years Current Role',       // 30
    'Top Skills',               // 31
    '_reserved',                // 32
    'Company Type Other',       // 33
    'Industry Other',           // 34
    'Hybrid Days',              // 35
    'Hybrid Days Frequency',    // 36
    'Company Location Other',   // 37
    'Office In Country',        // 38
    'Employment Other',         // 39
    'Perk Wellness',            // 40
    'Perk Home Office',         // 41
    'Perk Learning',            // 42
    'Perk Meal',                // 43
    'Perk Pension'              // 44
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  Logger.log('Wrote ' + headers.length + ' headers to Submissions row 1');
}

function getCachedCounts_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(COMP_COUNTS_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var submissionsSheet = ss.getSheetByName('Submissions');
  var emailsSheet = ss.getSheetByName('Emails');
  var historicalSheet = ss.getSheetByName('Historical');

  var surveys = 0;
  if (submissionsSheet && submissionsSheet.getLastRow() > 1) {
    var flags = submissionsSheet.getRange(2, 21, submissionsSheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < flags.length; i++) {
      if (String(flags[i][0]).trim().toLowerCase() === 'yes') surveys++;
    }
  }

  var submissionsCount = submissionsSheet ? Math.max(0, submissionsSheet.getLastRow() - 1) : 0;
  var historicalCount = historicalSheet ? Math.max(0, historicalSheet.getLastRow() - 1) : 0;

  var result = {
    submissions: submissionsCount,
    emails: emailsSheet ? Math.max(0, emailsSheet.getLastRow() - 1) : 0,
    surveys: surveys,
    historical: historicalCount,
    total: submissionsCount + historicalCount
  };

  cache.put(COMP_COUNTS_CACHE_KEY, JSON.stringify(result), 60);
  return result;
}

function saveEmailOnly_(ss, data) {
  var emailSheet = getOrCreateEmailSheet_(ss);
  var token = cleanToken_(data.token, 100) || Utilities.getUuid();
  var newsletterOptin = cleanBoolString_(data.newsletter_optin || data.newsletterOptin) === 'true';
  emailSheet.appendRow([
    new Date().toISOString(),
    cleanEmail_(data.email),
    cleanText_(data.source || 'frame_3', 40),
    true,
    newsletterOptin,
    cleanNumber_(data.percentile, 0, 100),
    token
  ]);

  clearPublicCaches_();
  return { status: 'ok', token: token };
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

  /* ── Read Submissions tab ──
   * Also aggregate base salary by district (column index 6).
   * Districts live only here — Historical has no district granularity.
   */
  var districtSamples = {};
  var sub = ss.getSheetByName('Submissions');
  if (sub && sub.getLastRow() > 1) {
    var sData = sub.getDataRange().getValues();
    for (var r = 1; r < sData.length; r++) {
      var row = sData[r];
      var base = parseSalary(row[2]);
      var total = parseSalary(row[3]);
      var role = mapSubmissionRole(String(row[4]).trim());
      var yoe = yoeToBucket(row[5]);
      var district = String(row[6] || '').trim();

      if (base > 0 && yoe) {
        entries.push({ base: base, total: total > 0 ? total : base, role: role, yoe: yoe });
      }
      if (base > 0 && ALLOWED_DISTRICTS[district]) {
        if (!districtSamples[district]) districtSamples[district] = [];
        districtSamples[district].push(total > 0 ? total : base);
      }
    }
  }

  /* ── Compute percentiles ── */
  var roleOrder = ['APM', 'PM', 'Senior PM', 'Lead/Principal', 'Director+', 'VP/Head/CPO'];
  var yoeOrder = ['0-1', '1-3', '3-5', '6-8', '9-12', '13+'];

  var allBase = entries.map(function(e) { return e.base; });
  var allTotal = entries.map(function(e) { return e.total; });

  var result = {
    overall: pcts(allBase, MIN_PUBLIC_BUCKET_N),
    roles: {},
    yoe: {},
    totalComp: {
      overall: pcts(allTotal, MIN_PUBLIC_BUCKET_N),
      roles: {},
      yoe: {}
    },
    totalEntries: entries.length
  };

  for (var i = 0; i < roleOrder.length; i++) {
    var role = roleOrder[i];
    var baseVals = entries.filter(function(e) { return e.role === role; }).map(function(e) { return e.base; });
    var totalVals = entries.filter(function(e) { return e.role === role; }).map(function(e) { return e.total; });
    result.roles[role] = pcts(baseVals, MIN_PUBLIC_BUCKET_N);
    result.totalComp.roles[role] = pcts(totalVals, MIN_PUBLIC_BUCKET_N);
  }

  for (var i = 0; i < yoeOrder.length; i++) {
    var yoe = yoeOrder[i];
    var baseVals = entries.filter(function(e) { return e.yoe === yoe; }).map(function(e) { return e.base; });
    var totalVals = entries.filter(function(e) { return e.yoe === yoe; }).map(function(e) { return e.total; });
    result.yoe[yoe] = pcts(baseVals, MIN_PUBLIC_BUCKET_N);
    result.totalComp.yoe[yoe] = pcts(totalVals, MIN_PUBLIC_BUCKET_N);
  }

  /* ── District aggregation (Submissions only) ──
   * portugal = subsample reference (all rows with a district + valid base salary).
   * byDistrict = per-district stats. Client filters by n threshold for display.
   */
  var districtKeys = Object.keys(districtSamples);
  var allDistrictBase = [];
  for (var dk = 0; dk < districtKeys.length; dk++) {
    var arr = districtSamples[districtKeys[dk]];
    for (var dj = 0; dj < arr.length; dj++) allDistrictBase.push(arr[dj]);
  }
  var byDistrict = {};
  for (var dk2 = 0; dk2 < districtKeys.length; dk2++) {
    byDistrict[districtKeys[dk2]] = pcts(districtSamples[districtKeys[dk2]], MIN_PUBLIC_DISTRICT_N);
  }
  result.districts = {
    portugal: pcts(allDistrictBase, MIN_PUBLIC_DISTRICT_N),
    byDistrict: byDistrict
  };

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

function pcts(arr, minN) {
  minN = minN || 3;
  arr = arr.filter(function(v) { return v > 0; });
  if (arr.length < minN) {
    return { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, n: arr.length, suppressed: true };
  }
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

/* ── DIAG: District distribution + median base salary (run from editor) ──
 * Reads Submissions only (Historical has no district granularity).
 * Output in Logger: View → Executions → latest run.
 */
function diagDistrictDistribution() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Submissions');
  if (!sheet || sheet.getLastRow() < 2) {
    Logger.log('No submissions');
    return;
  }

  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  var buckets = {};
  var totalWithDistrict = 0;
  var totalWithDistrictAndSalary = 0;

  for (var i = 0; i < rows.length; i++) {
    var district = String(rows[i][6] || '').trim();
    var base = parseSalary(rows[i][2]);
    if (!district) continue;
    totalWithDistrict++;
    if (!buckets[district]) buckets[district] = [];
    if (base > 0) {
      buckets[district].push(base);
      totalWithDistrictAndSalary++;
    }
  }

  var all = [];
  var keys = Object.keys(buckets);
  for (var k = 0; k < keys.length; k++) {
    for (var j = 0; j < buckets[keys[k]].length; j++) all.push(buckets[keys[k]][j]);
  }
  all.sort(function(a, b) { return a - b; });
  var natMedian = all.length > 0 ? percentile(all, 50) : 0;

  var out = [];
  for (var k2 = 0; k2 < keys.length; k2++) {
    var arr = buckets[keys[k2]].slice().sort(function(a, b) { return a - b; });
    var median = arr.length > 0 ? percentile(arr, 50) : 0;
    var p25 = arr.length >= 3 ? percentile(arr, 25) : 0;
    var p75 = arr.length >= 3 ? percentile(arr, 75) : 0;
    var delta = median > 0 && natMedian > 0
      ? Math.round((median - natMedian) / natMedian * 1000) / 10
      : null;
    out.push({
      district: keys[k2],
      n_total: buckets[keys[k2]].length === 0 ? 'n/a' : arr.length,
      n_with_salary: arr.length,
      median: median,
      p25: p25,
      p75: p75,
      delta_vs_national_pct: delta
    });
  }
  out.sort(function(a, b) { return b.n_with_salary - a.n_with_salary; });

  Logger.log('=== DISTRICT DISTRIBUTION (Submissions only) ===');
  Logger.log('Total rows with district: ' + totalWithDistrict);
  Logger.log('Total rows with district + valid salary: ' + totalWithDistrictAndSalary);
  Logger.log('National median (this sample): EUR ' + natMedian);
  Logger.log('');
  Logger.log('District | n | median | p25 | p75 | delta vs national');
  Logger.log('---------|---|--------|-----|-----|-------------------');
  for (var k3 = 0; k3 < out.length; k3++) {
    var r = out[k3];
    Logger.log(
      r.district + ' | ' + r.n_with_salary +
      ' | EUR ' + r.median +
      ' | EUR ' + r.p25 +
      ' | EUR ' + r.p75 +
      ' | ' + (r.delta_vs_national_pct === null ? '—' : r.delta_vs_national_pct + '%')
    );
  }
  Logger.log('');
  Logger.log('JSON:');
  Logger.log(JSON.stringify(out, null, 2));
}

/* ── DIAG: Count Submissions rows with totalComp populated (run from editor) ── */
function diagTotalCompCoverage() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Submissions');
  if (!sheet || sheet.getLastRow() < 2) {
    Logger.log('No submissions');
    return;
  }
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  var withTotal = 0, withoutTotal = 0;
  var liftSum = 0, maxLift = 0;
  for (var i = 0; i < rows.length; i++) {
    var base = parseSalary(rows[i][2]);
    var total = parseSalary(rows[i][3]);
    var district = String(rows[i][6] || '').trim();
    if (!base || !district) continue;
    if (total > 0) {
      withTotal++;
      var lift = total - base;
      liftSum += lift;
      if (lift > maxLift) maxLift = lift;
    } else {
      withoutTotal++;
    }
  }
  var pct = Math.round(withTotal / (withTotal + withoutTotal) * 1000) / 10;
  var avgLift = withTotal > 0 ? Math.round(liftSum / withTotal) : 0;
  Logger.log('Rows with base + district: ' + (withTotal + withoutTotal));
  Logger.log('  With totalComp > 0: ' + withTotal + ' (' + pct + '%)');
  Logger.log('  Without totalComp: ' + withoutTotal);
  Logger.log('  Avg lift among those who have it: EUR ' + avgLift);
  Logger.log('  Max lift: EUR ' + maxLift);
}
