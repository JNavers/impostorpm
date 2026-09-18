# Status

Last updated: 2026-09-18 (Claude, session c49ed8fc — failover threshold raised
to 95 by the user so this session could finish the clean-up)

## Objective

Move the Salary Compass backend off Google Sheets + Apps Script onto Supabase
Postgres, with the API as Cloudflare Pages Functions in this repo.

The user's standing constraint: **build and test in isolation, ship nothing to
production until the whole thing is tested.** Honour it — production is still
served by Apps Script and must stay that way until the parity gate passes.

## Where the work lives

Branch `worktree-compass-backend-migration`, commit `6bfbf4f`, pushed to
`JNavers/impostorpm`. Developed in the git worktree at
`.claude/worktrees/compass-backend-migration`; the branch is on the remote, so
it can be checked out anywhere.

`db/README.md` is the substantive document: runbook, seven findings, design
rationale. **Read it before continuing** rather than re-deriving any of it.

## Completed

- Audited the live system against production (not from the code alone):
  430 submissions / 32 completed surveys / 88 contacts / 742 historical rows;
  percentile `GET` measured at 1.06 s warm, 3.33 s cold, for 3.4 kB.
- `db/sql/001..004`: schema, benchmark computation, API RPCs, RLS.
- `functions/api/compass/`: four endpoints (benchmark, create submission,
  patch survey, contacts) plus `_lib.js` and extracted email templates.
- Test harness on PGlite (Postgres 17 in WASM) — no Docker, no network, no
  credentials.
- `db/scripts/verify-parity.mjs`: the three-way gate for step 1.

## Not started

Steps 2–5 of the runbook in `db/README.md`. Nothing is wired to the frontend;
`public/salary-compass/index.html` is untouched and still posts to Apps Script.
No Supabase project exists. The reminder/result email senders are not written
(only `compass_pending_reminders`, the queue query, is ported and tested).

## Blocker — one open question, and it is NOT the port

`npm run parity` now runs end to end on the real exports. Result:

```
SQL vs oracle (is the port faithful?)
  ✔ SQL ↔ oracle: identical          ← over all 1 171 real rows
Oracle vs production (is the export complete?)
  ✖ oracle ↔ production: 31 difference(s)
```

**The SQL port is proven faithful against production data.** That was the
migration's main risk and it is closed.

The open question is the second half. The differences are strange in a
specific, useful way:

- **The row sets are identical.** totalEntries 1030 = 1030, and every single
  bucket matches: yoe 0-1 n=101, 1-3 n=269, 3-5 n=295, 6-8 n=217, 9-12 n=109,
  13+ n=39, districts n=427, roles PM n=161. Same rows, same counts.
- **Only some VALUES differ**, and only in the upper tail (p50/p75/p90). Our
  figure is consistently the HIGHER one: `overall.p90` 85 000 vs 80 000,
  `yoe.9-12.p90` 117 600 vs 95 200.
- **`roles.*` and `districts.*` match perfectly.** Consistent with the finding
  below that the historical `Role` column holds salary bands, so role buckets
  are computed from submissions only — which agree. The disagreement is
  therefore isolated to the HISTORICAL rows.

Same rows, different values, historical only. Two hypotheses, neither verified:

1. **CSV export vs `getValues()` read different cell values.** Apps Script gets
   typed values; the CSV gets whatever Sheets serialises. A cell that is text
   in one view and a number in the other would parse differently through
   `parseSalary`.
2. **Production is serving a stale computation.** The 300 s cache is only
   invalidated by API writes, so a manual edit to the Sheet would not clear it.

**How to settle it:** pick one differing bucket (`yoe.9-12.p90`, the biggest
gap) and dump the sorted values feeding it from the CSV, then compare against
what the Sheet shows for those same rows. That names the cell, and the cell
names the cause.

This does not block building the backend. It blocks *claiming* the benchmark is
reproduced, so it must be answered before the cutover.

## Test state

`cd db && npm install && npm test` → **56 passing, 0 failing**.
Split: 5 benchmark parity, 8 CSV import, 9 historical clean-up, 12 RPC, 22 endpoint.

`npm run parity` runs end to end on the real exports: SQL ↔ oracle identical.
`node scripts/verify-parity.mjs --clean` reports the clean-up's impact and
writes `db/fixtures/historical-exclusions.log.json` (git-ignored).

`npm run build` at the repo root succeeds — the new `functions/` files do not
break the Astro build.

Verified by negative control: reverting `compass_percentile` to `numeric`
rounding makes the parity test fail, and restoring it makes it pass. The suite
detects the regression it claims to.

## Next action

1. **Settle the oracle-vs-production question** (see Blocker). Dump the sorted
   values behind `yoe.9-12.p90` from the CSV and compare against the Sheet.
2. **Decide what the clean-up does to the published numbers.** Measured impact,
   `node scripts/verify-parity.mjs --clean`: overall n 1030 → 1003,
   `overall.p90` 85 000 → 80 000, `yoe.9-12.p90` **117 600 → 93 500**. The
   median barely moves. These figures are live on impostor.pm today, so the
   cutover is a visible change and probably deserves a note to the community.
3. **Then step 2 of the runbook** in `db/README.md`: create the Supabase
   project, apply `db/sql/`, deploy to a preview URL, verify, and only then
   start the dual-write window.

## New finding — the historical "Role" column is not roles

Discovered 2026-09-18 while checking the high-end salaries. The Historical tab's
column 20 is headed `Role`, which is why `mapHistorical()` resolves it, but its
contents are **salary bands**:

```
681  ""            ← empty
 16  "40K-50K"
 10  "30K-40K"
  6  "50K-60K"
  6  "60K-70K"
  5  "0-10K"
  …
  1  "#REF!"       ← a broken spreadsheet formula
```

`mapHistoricalRole()` therefore returns NULL for effectively every historical
row. Consequence: **the per-role percentiles published today (APM, PM, Senior
PM, …) are computed from the ~400 new submissions only.** The 742 historical
rows contribute to `overall` and to the years-of-experience cuts, but to no role
bucket at all — despite `Code.gs` appearing to use them for exactly that.

This is a finding about production, not about the migration; the SQL port
reproduces the same behaviour faithfully. Whether the old Form ever captured a
role, and whether it lives in another column, needs checking against the Sheet
before anyone tries to "restore" it.

## Correction to finding 7 in db/README.md

`db/README.md` says the two cron scripts cannot be verified from the repo,
because both carry `DRY_RUN = true` in git and there is no clasp. A live
`?action=debug` call on 2026-09-18 shows the `Emails` sheet has 13 columns
ending in `Reminder 1 Sent`, `Reminder 2 Sent`, `Result Email Sent` — the
columns whose manual creation is the documented setup step for those scripts.
So both are almost certainly deployed and live with `DRY_RUN = false`, and the
repo copies are stale on that line. Still confirm in the web editor before
relying on it, but plan for "they are sending" rather than "unknown".

## Watch out

- Do **not** "improve" `compass_percentile` to `numeric` or `percentile_cont`.
  See DECISIONS.md; there is a test guarding it and a reason in the SQL comment.
- Do **not** touch `functions/api/salary-compass-email.js`. It serves the live
  page; folding it into `contacts.js` is step 5.
- Editing `public/salary-compass/index.html` (step 3) breaks the
  "byte-identical to the migrated original" assertion in
  `scripts/validate-production.mjs`. Update both in the same commit.
