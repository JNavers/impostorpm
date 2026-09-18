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
 *
 * `clean` is OFF by default, and that default is load-bearing. The parity gate
 * has to compare like with like: with `clean: false` the rows are exactly what
 * production aggregates, which is what makes SQL-vs-oracle-vs-production a
 * meaningful control. Pass `clean: true` for the real migration import, where
 * decisions A–C apply.
 */
export function mapHistorical(rows, { clean = false } = {}) {
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

  const out = body.map((r, i) => ({
    line: i + 2, // 1-indexed, plus the header row — matches what a spreadsheet shows
    country: String(r[col.country] ?? '').trim(),
    // parseSalary() semantics, applied at import so the stored integer is the
    // number production actually aggregates. See the note in verify-parity.
    base: parseSalaryFromExport(r[col.base]),
    total: col.total !== undefined ? parseSalaryFromExport(r[col.total]) : 0,
    role: String(r[col.role] ?? '').trim(),
    yoe: String(r[col.yoe] ?? '').trim(),
    outlier: col.outlier !== undefined && String(r[col.outlier] ?? '').trim().toUpperCase() === 'TRUE'
  }));

  if (!clean) return { rows: out, problems, col, excluded: [], repaired: [] };

  const { rows: cleaned, excluded, repaired } = cleanHistorical(out);
  return { rows: cleaned, problems, col, excluded, repaired };
}

/**
 * The historical clean-up, per decisions A–C in docs/agent/DECISIONS.md.
 *
 * The old Google Form took salary as free text with no validation, so a value
 * that looks wrong probably IS wrong rather than merely extreme. The user's
 * call was to drop what cannot be trusted rather than guess a replacement —
 * `submissions`, which goes through the validated API, is trusted and is NOT
 * subject to any of this.
 *
 * Every exclusion and repair is returned so the importer can log it. Dropping
 * rows means the table stops mirroring the Sheet, and "we removed 27 rows, here
 * is exactly which" has to stay answerable afterwards.
 */
export function cleanHistorical(rows) {
  const kept = [];
  const excluded = [];
  const repaired = [];

  for (const row of rows) {
    // Decision A — the Compass is a Portuguese benchmark. Not a filter change
    // to the published numbers (compass_entries already restricts to Portugal),
    // a change to what gets stored.
    if (row.country !== 'Portugal') {
      excluded.push({ ...row, reason: 'not-portugal' });
      continue;
    }

    // Rows the Sheet itself already flagged. Kept as-is: the benchmark honours
    // the flag, and re-deciding someone else's outlier call is not this job.
    if (row.outlier) {
      kept.push(row);
      continue;
    }

    // Decision C — implausible on their face, and unrepairable with confidence.
    //  > 200 000: sixteen rows in the millions (probably "55 000,00" flattened
    //    by parseSalary) plus 225 000 and 350 000, which could be genuine. The
    //    user was not confident in either, so all of them go.
    //  100 – 9 999: monthly pay quoted in an annual field (3000 with perks of
    //    31 646), plus rows whose perks value is incoherent with any reading.
    if (row.base > MAX_PLAUSIBLE_BASE) {
      excluded.push({ ...row, reason: 'implausible-high' });
      continue;
    }
    if (row.base >= 100 && row.base < 10000) {
      excluded.push({ ...row, reason: 'implausible-monthly-or-junk' });
      continue;
    }

    // Decision B — the one repair. A respondent typing `18` meant 18 000; the
    // user was explicit about this group and only this group. Note the bound is
    // 100, not 1000: `450` means 45 000, not 450 000, which a blanket ×1000
    // would have invented.
    if (row.base > 0 && row.base < 100) {
      const before = row.base;
      const after = before * 1000;
      repaired.push({ ...row, reason: 'thousands-shorthand', before, after });
      kept.push({ ...row, base: after, total: row.total > 0 && row.total < 100 ? row.total * 1000 : row.total });
      continue;
    }

    kept.push(row);
  }

  return { rows: kept, excluded, repaired };
}

/** Above this, a Portuguese PM salary in the historical set is not believable. */
export const MAX_PLAUSIBLE_BASE = 200000;

/**
 * Code.gs parseSalary(), verbatim.
 *
 * Correct for what it was written against — Apps Script's getValues(), which
 * hands back the underlying NUMBER of a cell — and wrong for a CSV export,
 * which serialises the FORMATTED text. Use parseSalaryFromExport below to read
 * an export; this one is kept because the oracle has to be able to demonstrate
 * the difference, and because its parseInt behaviour is a documented finding.
 */
export function parseSalaryLegacy(val) {
  if (!val) return 0;
  const s = String(val).replace(/[\s ,]/g, '').trim();
  const n = parseInt(s);
  return isNaN(n) ? 0 : n;
}

/**
 * Reads a salary cell out of a Google Sheets CSV export.
 *
 * The export writes what the cell DISPLAYS, so a cell holding 42000 formatted
 * in the Portuguese locale arrives as `"42 000,00"` — space for thousands,
 * comma for decimals. parseSalaryLegacy strips both without understanding
 * either and returns 4 200 000.
 *
 * That produced a hundredfold error on 17 of the 604 Portugal rows, every one
 * of them an ordinary salary between 15 500 and 56 000. It is also the entire
 * explanation for the parity gate's "31 differences with identical row counts":
 * production reads the Sheet directly and never saw those millions — only the
 * export did.
 *
 * It matters beyond the numbers. Those phantom millions were reported to the
 * user as corrupt data, and on that basis they decided to delete 18 rows. The
 * data was fine; the reader was broken.
 */
export function parseSalaryFromExport(val) {
  if (val === null || val === undefined) return 0;
  let s = String(val).trim();
  if (!s) return 0;

  s = s.replace(/[\s ]/g, '');            // thousands separators
  s = s.replace(/,(\d{1,2})$/, '');            // trailing decimals, comma style
  s = s.replace(/\.(\d{1,2})$/, '');           // trailing decimals, dot style
  s = s.replace(/[,.]/g, '');                  // any remaining grouping marks

  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

function intOrNull(v) {
  const n = parseSalaryFromExport(v);
  return n > 0 ? n : null;
}

function numOrNull(v) {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
