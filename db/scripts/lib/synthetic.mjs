/**
 * Deterministic synthetic dataset, shaped like the real Sheet.
 *
 * The real data cannot be committed and is not reachable from here, so parity
 * is proven twice: now, against generated rows that exercise every branch of
 * computePercentiles(); and again at migration time, against the exported
 * Sheet (scripts/verify-parity.mjs), where this generator is not used.
 *
 * Seeded so a failing run is reproducible. Sizes are chosen so that some
 * buckets land above the suppression threshold and some land below it —
 * a dataset where nothing is suppressed would not test the suppression path.
 */

/** mulberry32: small, seeded, and stable across Node versions. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUBMISSION_ROLES = [
  'APM', 'PM', 'Senior PM', 'Lead PM', 'Principal PM',
  'Director of Product', 'Head of Product', 'VP of Product', 'CPO'
];

const HISTORICAL_ROLES = [
  '01-Associate/Junior Product Manager', '02-Mid Product Manager',
  '03-Senior Product Manager', '04-Principal Product Manager',
  '05-Lead/Group Product Manager', '06-Head of Product',
  '08-Director of Product Management', '10-VP of Product Management',
  '12-Chief Product Officer',
  // Present in the real export, absent from mapHistoricalRole() on purpose:
  // it must land in `overall` but in no role bucket.
  '11-Senior Vice President of Product'
];

// Porto-heavy, matching the real sample's known skew.
const DISTRICTS = [
  ...Array(18).fill('Porto'),
  ...Array(12).fill('Lisboa'),
  ...Array(4).fill('Braga'),
  ...Array(3).fill('Aveiro'),
  'Coimbra', 'Faro', 'Setúbal', 'Madeira'
];

export function generate({ seed = 20260918, submissions = 430, historical = 742 } = {}) {
  const r = rng(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

  const submissionRows = [];
  for (let i = 0; i < submissions; i++) {
    // ~7% are "Not a PM" leads: no salary, no years, no district. They must be
    // stored and counted, and must never reach the benchmark.
    if (r() < 0.07) {
      submissionRows.push({ role: 'Not a PM', base: null, total: null, yoe: null, district: null });
      continue;
    }

    const role = pick(SUBMISSION_ROLES);
    const base = int(22000, 140000);
    // ~55% supply total comp; the rest must fall back to base.
    const total = r() < 0.55 ? base + int(0, 40000) : null;
    // A tenth are decimals, which is what the survey's slider actually emits.
    const yoe = r() < 0.1 ? Math.round(r() * 200) / 10 : int(0, 25);

    submissionRows.push({
      role,
      base,
      total,
      yoe,
      district: pick(DISTRICTS),
      full_survey: r() < 0.075 // matches the real 32/430 completion rate
    });
  }

  const historicalRows = [];
  for (let i = 0; i < historical; i++) {
    const base = int(18000, 160000);
    historicalRows.push({
      // ~12% are outside Portugal and must be filtered out.
      country: r() < 0.12 ? 'Spain' : 'Portugal',
      base,
      total: r() < 0.6 ? base + int(0, 30000) : null,
      role: pick(HISTORICAL_ROLES),
      // The legacy Form's string buckets, plus plain numbers and a decimal comma.
      yoe: pick(['0-2', '3-5', '6-8', '9-12', '13+', '7', '2', '15', '1,5']),
      // ~3% flagged outliers, excluded by computePercentiles().
      outlier: r() < 0.03 ? 'TRUE' : 'FALSE'
    });
  }

  return { submissions: submissionRows, historical: historicalRows };
}

/**
 * Edge cases that a random draw is unlikely to produce but that the two
 * implementations must agree on. Kept separate so the main dataset stays
 * representative and these stay legible.
 */
export function edgeCases() {
  return {
    historical: [
      // Every filter, one row each.
      { country: 'Portugal', base: 50000, total: null, role: '02-Mid Product Manager', yoe: '3-5', outlier: 'FALSE' },
      { country: 'Brazil', base: 999999, total: null, role: '02-Mid Product Manager', yoe: '3-5', outlier: 'FALSE' },
      { country: 'Portugal', base: 999999, total: null, role: '02-Mid Product Manager', yoe: '3-5', outlier: 'TRUE' },
      { country: 'Portugal', base: 0, total: 80000, role: '02-Mid Product Manager', yoe: '3-5', outlier: 'FALSE' },
      { country: 'Portugal', base: 50000, total: null, role: '02-Mid Product Manager', yoe: '', outlier: 'FALSE' },
      { country: 'Portugal', base: 50000, total: null, role: 'Unmapped Role', yoe: '6-8', outlier: 'FALSE' },
      // Exact bucket boundaries: 1, 3, 5, 8, 12 all sit ON a boundary.
      { country: 'Portugal', base: 40000, total: null, role: '01-Associate/Junior Product Manager', yoe: '1', outlier: 'FALSE' },
      { country: 'Portugal', base: 41000, total: null, role: '01-Associate/Junior Product Manager', yoe: '3', outlier: 'FALSE' },
      { country: 'Portugal', base: 42000, total: null, role: '01-Associate/Junior Product Manager', yoe: '5', outlier: 'FALSE' },
      { country: 'Portugal', base: 43000, total: null, role: '01-Associate/Junior Product Manager', yoe: '8', outlier: 'FALSE' },
      { country: 'Portugal', base: 44000, total: null, role: '01-Associate/Junior Product Manager', yoe: '12', outlier: 'FALSE' },
      { country: 'Portugal', base: 45000, total: null, role: '01-Associate/Junior Product Manager', yoe: '0', outlier: 'FALSE' }
    ],
    submissions: [
      // An 11-value bucket makes the p50 index land exactly on an element, which
      // is the one path where percentile() returns unrounded.
      ...Array.from({ length: 11 }, (_, i) => ({
        role: 'Senior PM', base: 60000 + i * 1000, total: null, yoe: 4, district: 'Lisboa'
      })),
      // A 2-value bucket forces interpolation to a .5 midpoint, where JS
      // Math.round and Postgres round() could in principle disagree.
      { role: 'CPO', base: 100001, total: null, yoe: 20, district: 'Porto' },
      { role: 'CPO', base: 100002, total: null, yoe: 20, district: 'Porto' },
      // Total comp below base is impossible via the API, but the Sheet holds
      // rows from before that rule existed. Loaded here without the CHECK.
      { role: 'PM', base: 50000, total: null, yoe: 2, district: 'Braga' },
      // A district with fewer than MIN_PUBLIC_DISTRICT_N samples must suppress.
      { role: 'PM', base: 55000, total: null, yoe: 2, district: 'Guarda' },
      { role: 'PM', base: 56000, total: null, yoe: 2, district: 'Guarda' },
      // "Not a PM" with a salary: still excluded, even though it has one.
      { role: 'Not a PM', base: null, total: null, yoe: null, district: null }
    ]
  };
}
