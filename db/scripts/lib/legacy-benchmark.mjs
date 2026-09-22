/**
 * A literal port of computePercentiles() and its helpers from
 * apps-script/salary-compass/Code.gs.
 *
 * This file is the ORACLE for the migration. It is deliberately not good
 * JavaScript: it keeps the original's var-less loops flattened, its rounding,
 * its fallbacks and its quirks, because its only job is to answer "what number
 * does production print today?" so the SQL port can be diffed against it.
 *
 * Do not refactor it. Do not fix its bugs. When production's Code.gs changes,
 * change this in the same commit.
 */

export const MIN_PUBLIC_BUCKET_N = 5;
export const MIN_PUBLIC_DISTRICT_N = 10;

export const ALLOWED_DISTRICTS = {
  Aveiro: true, Beja: true, Braga: true, 'Bragança': true, 'Castelo Branco': true,
  Coimbra: true, 'Évora': true, Faro: true, Guarda: true, Leiria: true,
  Lisboa: true, Portalegre: true, Porto: true, 'Santarém': true, 'Setúbal': true,
  'Viana do Castelo': true, 'Vila Real': true, Viseu: true, 'Açores': true, Madeira: true
};

/** Code.gs parseSalary(). Note parseInt, not parseFloat: "50.000" reads as 50. */
export function parseSalary(val) {
  if (!val) return 0;
  const s = String(val).replace(/[\s ,]/g, '').trim();
  const n = parseInt(s);
  return isNaN(n) ? 0 : n;
}

export function percentile(sortedArr, p) {
  const k = (sortedArr.length - 1) * p / 100;
  const f = Math.floor(k);
  const c = Math.ceil(k);
  if (f === c) return sortedArr[f];
  return Math.round(sortedArr[f] + (k - f) * (sortedArr[c] - sortedArr[f]));
}

export function pcts(arr, minN) {
  minN = minN || 3;
  arr = arr.filter((v) => v > 0);
  if (arr.length < minN) {
    return { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0, n: arr.length, suppressed: true };
  }
  arr = arr.slice().sort((a, b) => a - b);
  return {
    p10: percentile(arr, 10),
    p25: percentile(arr, 25),
    p50: percentile(arr, 50),
    p75: percentile(arr, 75),
    p90: percentile(arr, 90),
    n: arr.length
  };
}

export function mapHistoricalRole(role) {
  const map = {
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

export function mapSubmissionRole(role) {
  const map = {
    APM: 'APM',
    PM: 'PM',
    'Senior PM': 'Senior PM',
    'Lead PM': 'Lead/Principal',
    'Principal PM': 'Lead/Principal',
    'Director of Product': 'Director+',
    'Head of Product': 'Director+',
    'VP of Product': 'VP/Head/CPO',
    CPO: 'VP/Head/CPO'
  };
  return map[role] || null;
}

export function numToBucket(y) {
  if (y < 0) return null;
  if (y <= 1) return '0-1';
  if (y <= 3) return '1-3';
  if (y <= 5) return '3-5';
  if (y <= 8) return '6-8';
  if (y <= 12) return '9-12';
  return '13+';
}

export function yoeToBucket(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number' && !isNaN(val)) return numToBucket(val);

  const s = String(val).trim();
  if (s === '') return null;

  const legacyMidpoint = { '0-2': 1, '3-5': 4, '6-8': 7, '9-12': 10, '13+': 14 };
  if (Object.prototype.hasOwnProperty.call(legacyMidpoint, s)) {
    return numToBucket(legacyMidpoint[s]);
  }

  const y = parseFloat(s.replace(',', '.'));
  if (isNaN(y)) return null;
  return numToBucket(y);
}

/**
 * computePercentiles(), with the two sheets passed in as plain arrays instead
 * of read from SpreadsheetApp.
 *
 * @param {Array<{country,base,total,role,yoe,outlier}>} historical
 * @param {Array<{role,base,total,yoe,district}>} submissions
 */
export function computePercentiles(historical, submissions) {
  const entries = [];

  for (const row of historical) {
    if (String(row.country).trim() !== 'Portugal') continue;
    if (String(row.outlier).trim().toUpperCase() === 'TRUE') continue;

    const base = parseSalary(row.base);
    const total = parseSalary(row.total);
    const role = mapHistoricalRole(String(row.role).trim());
    const yoe = yoeToBucket(row.yoe);

    if (base > 0 && yoe) {
      entries.push({ base, total: total > 0 ? total : base, role, yoe });
    }
  }

  const districtSamples = {};
  for (const row of submissions) {
    const rawRole = String(row.role).trim();
    if (rawRole === 'Not a PM') continue;

    const base = parseSalary(row.base);
    const total = parseSalary(row.total);
    const role = mapSubmissionRole(rawRole);
    const yoe = yoeToBucket(row.yoe);
    const district = String(row.district || '').trim();

    if (base > 0 && yoe) {
      entries.push({ base, total: total > 0 ? total : base, role, yoe });
    }
    if (base > 0 && ALLOWED_DISTRICTS[district]) {
      if (!districtSamples[district]) districtSamples[district] = [];
      districtSamples[district].push(total > 0 ? total : base);
    }
  }

  const roleOrder = ['APM', 'PM', 'Senior PM', 'Lead/Principal', 'Director+', 'VP/Head/CPO'];
  const yoeOrder = ['0-1', '1-3', '3-5', '6-8', '9-12', '13+'];

  const allBase = entries.map((e) => e.base);
  const allTotal = entries.map((e) => e.total);

  const result = {
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

  for (const role of roleOrder) {
    result.roles[role] = pcts(entries.filter((e) => e.role === role).map((e) => e.base), MIN_PUBLIC_BUCKET_N);
    result.totalComp.roles[role] = pcts(entries.filter((e) => e.role === role).map((e) => e.total), MIN_PUBLIC_BUCKET_N);
  }

  for (const yoe of yoeOrder) {
    result.yoe[yoe] = pcts(entries.filter((e) => e.yoe === yoe).map((e) => e.base), MIN_PUBLIC_BUCKET_N);
    result.totalComp.yoe[yoe] = pcts(entries.filter((e) => e.yoe === yoe).map((e) => e.total), MIN_PUBLIC_BUCKET_N);
  }

  const districtKeys = Object.keys(districtSamples);
  const allDistrictBase = [];
  for (const dk of districtKeys) {
    for (const v of districtSamples[dk]) allDistrictBase.push(v);
  }
  const byDistrict = {};
  for (const dk of districtKeys) {
    byDistrict[dk] = pcts(districtSamples[dk], MIN_PUBLIC_DISTRICT_N);
  }
  result.districts = { portugal: pcts(allDistrictBase, MIN_PUBLIC_DISTRICT_N), byDistrict };

  return result;
}
