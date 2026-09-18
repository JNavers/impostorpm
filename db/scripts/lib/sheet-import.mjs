/**
 * Reads the Google Sheet exports and turns them into rows.
 *
 * Column mapping follows Code.gs exactly, including its tolerant header
 * matching for the Historical tab (normalizeHeader + substring tests), because
 * that tab's headers are long Google Form question texts that have been edited
 * before. A header the mapper cannot resolve is reported loudly rather than
 * silently dropped — the current code only writes a Logger.log nobody reads.
 */

/** RFC4180-ish CSV parser: quoted fields, embedded commas, newlines and "". */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  // Strip a UTF-8 BOM, which Google Sheets exports include.
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  for (; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/** Code.gs normalizeHeader(). */
export function normalizeHeader(val) {
  return String(val || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const SUBMISSION_COLUMNS = [
  'ID', 'Timestamp', 'Base Salary', 'Total Comp', 'Role', 'YoE', 'City',
  'Perception Guess', 'Gender', 'Company', 'Industry', 'Org Size',
  'Company Type', 'Remote Policy', 'Company Location', 'Employment', 'Perks',
  'Transparency', 'Salary Adequacy', 'Negotiation Comfort', 'Full Survey',
  'Dashboard Token', 'Bonus', 'Equity Grant', 'Full Survey Total Comp',
  'Currency', 'Has Equity', 'Perks Value', 'Seniority', 'Years Current Role',
  'Top Skills', '_reserved', 'Company Type Other', 'Industry Other',
  'Hybrid Days', 'Hybrid Days Frequency', 'Company Location Other',
  'Office In Country', 'Employment Other', 'Perk Wellness', 'Perk Home Office',
  'Perk Learning', 'Perk Meal', 'Perk Pension'
];

/** Columns that become typed submissions fields; everything else goes to `survey`. */
const TYPED = new Set([
  'ID', 'Timestamp', 'Base Salary', 'Total Comp', 'Role', 'YoE', 'City',
  'Perception Guess', 'Full Survey', 'Dashboard Token', '_reserved'
]);

/**
 * Submissions tab → rows.
 *
 * Positional by design: Code.gs writes by column index, so the export's header
 * text is advisory and the position is the contract. The header row is still
 * checked, and a mismatch aborts rather than importing shifted data.
 */
export function mapSubmissions(rows) {
  const [header, ...body] = rows;
  const problems = [];

  SUBMISSION_COLUMNS.forEach((expected, idx) => {
    const actual = String(header[idx] ?? '').trim();
    if (normalizeHeader(actual) !== normalizeHeader(expected)) {
      problems.push(`column ${idx + 1}: expected "${expected}", found "${actual}"`);
    }
  });

  const out = body.map((r) => {
    const survey = {};
    SUBMISSION_COLUMNS.forEach((name, idx) => {
      if (TYPED.has(name)) return;
      const v = String(r[idx] ?? '').trim();
      if (v !== '') survey[name] = v;
    });

    return {
      legacy_id: String(r[0] ?? '').trim(),
      created_at: String(r[1] ?? '').trim() || null,
      base: intOrNull(r[2]),
      total: intOrNull(r[3]),
      role: String(r[4] ?? '').trim(),
      yoe: numOrNull(r[5]),
      district: String(r[6] ?? '').trim() || null,
      perception: intOrNull(r[7]),
      full_survey: String(r[20] ?? '').trim().toLowerCase() === 'yes',
      token: String(r[21] ?? '').trim() || null,
      survey
    };
  });

  return { rows: out, problems };
}

/**
 * Historical tab → rows, using Code.gs's tolerant header resolution verbatim.
 * Its `hCol` lookup is reproduced rather than replaced so that the rows this
 * imports are exactly the rows production aggregates today.
 */
export function mapHistorical(rows) {
  const [header, ...body] = rows;
  const col = {};
  header.forEach((h, i) => {
    const norm = normalizeHeader(h);
    if (norm === 'wheredoyoureside') col.country = i;
    else if (norm.includes('beforetaxes') && norm.includes('withoutperks')) col.base = i;
    else if (norm.includes('beforetaxes') && norm.includes('withperks') && !norm.includes('without')) col.total = i;
    else if (norm === 'role') col.role = i;
    else if (norm.includes('howmanyyearsofexperience') && norm.includes('product')) col.yoe = i;
    else if (norm === 'outlier') col.outlier = i;
  });

  const problems = [];
  for (const required of ['country', 'base', 'role', 'yoe']) {
    if (col[required] === undefined) {
      problems.push(`Historical: could not resolve the "${required}" column from the header row`);
    }
  }
  if (problems.length) return { rows: [], problems, col };

  const out = body.map((r) => ({
    country: String(r[col.country] ?? '').trim(),
    // parseSalary() semantics, applied at import so the stored integer is the
    // number production actually aggregates. See the note in verify-parity.
    base: parseSalaryLegacy(r[col.base]),
    total: col.total !== undefined ? parseSalaryLegacy(r[col.total]) : 0,
    role: String(r[col.role] ?? '').trim(),
    yoe: String(r[col.yoe] ?? '').trim(),
    outlier: col.outlier !== undefined && String(r[col.outlier] ?? '').trim().toUpperCase() === 'TRUE'
  }));

  return { rows: out, problems, col };
}

/** Code.gs parseSalary(). parseInt, so "50.000" reads as 50 — see verify-parity. */
export function parseSalaryLegacy(val) {
  if (!val) return 0;
  const s = String(val).replace(/[\s ,]/g, '').trim();
  const n = parseInt(s);
  return isNaN(n) ? 0 : n;
}

function intOrNull(v) {
  const n = parseSalaryLegacy(v);
  return n > 0 ? n : null;
}

function numOrNull(v) {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
