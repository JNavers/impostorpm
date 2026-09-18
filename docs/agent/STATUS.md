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
- `db/scripts/verify-parity.mjs`: the three-way gate for step 1, run against
  the real exports. SQL ↔ oracle identical.
- The export-parsing bug found and fixed (see the CORRECTION in DECISIONS.md).
- The scheduled emails ported: `functions/api/compass/cron.js` + `_senders.js`,
  replacing result-emails.gs and survey-reminders.gs. Dry run is a query
  parameter, and a failed send is retried rather than lost.

## Not started

Steps 2–5 of the runbook in `db/README.md`. Nothing is wired to the frontend;
`public/salary-compass/index.html` is untouched and still posts to Apps Script.
No Supabase project exists, so nothing has been run against a real database —
only PGlite. The dual-write change to the frontend (step 3) is the next
substantial piece of code and has not been started.

## Blocker — resolved. The remaining gap is a stale export.

The 31-difference mystery is solved, and it was a bug in the importer, not in
the port or in the data. See the CORRECTION entry at the top of DECISIONS.md.

Short version: the CSV export serialises formatted cell text (`"42 000,00"`),
while Apps Script reads the underlying number through `getValues()`. Code.gs's
`parseSalary` strips the space and the comma without understanding either, so
17 Portugal rows were read a hundredfold too large. Production never saw them.
`parseSalaryFromExport()` fixes it; `parseSalaryLegacy()` stays as the
regression witness.

After the fix the gate reports:

```
SQL vs oracle:       ✔ identical
oracle vs production: 28 tiny differences, and overall.n 1030 vs 1031
```

That last number is the whole remaining story: **production has more rows than
the export does.** Confirmed directly — the live counter reads 432 submissions
while `submissions.csv` holds 428. People kept filling in the survey after the
download. Every remaining difference is the few euros that one or two extra
rows move a percentile by.

**This is not a defect and it is not a blocker.** To close it formally,
re-export both tabs and re-run `npm run parity` promptly; the counts should
line up and the differences should vanish. Expect it to drift again within
hours — the gate is best run right after a fresh export.

## Test state

`cd db && npm install && npm test` → **77 passing, 0 failing**.
Split: 5 benchmark parity, 8 CSV import, 7 export parsing, 9 historical
clean-up, 12 RPC, 22 endpoint, 14 scheduled email.

`npm run build` at the repo root succeeds.

`npm run parity` runs end to end on the real exports: SQL ↔ oracle identical.
`node scripts/verify-parity.mjs --clean` reports the clean-up's impact and
writes `db/fixtures/historical-exclusions.log.json` (git-ignored).

`npm run build` at the repo root succeeds — the new `functions/` files do not
break the Astro build.

Verified by negative control: reverting `compass_percentile` to `numeric`
rounding makes the parity test fail, and restoring it makes it pass. The suite
detects the regression it claims to.

## Next action

1. **Ask the user to re-confirm decision C.** With correct parsing it drops 12
   Portugal rows, not 27, and the two above €200 000 (225 000 and 350 000) are
   now the only high ones rather than the tail of sixteen implausible ones. The
   premise they decided on has changed.
2. **Re-export and re-run `npm run parity`** to close the count gap formally
   (432 live vs 428 in the export). Do it back to back; it drifts within hours.
3. **Then step 2 of the runbook** in `db/README.md`: create the Supabase
   project, apply `db/sql/`, deploy to a preview URL, and start the dual-write
   window.

Measured impact of the clean-up, for the conversation in (1)
(`node scripts/verify-parity.mjs --clean`): overall n 1030 → 1003,
`yoe.9-12.p90` 95 200 → 92 000, `yoe.0-1.p10` 18 000 → 19 570. Small and
defensible now, unlike the 117 600 → 93 500 swing the parsing bug implied.

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
