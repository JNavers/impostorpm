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

## Blocker — none. Step 1 is complete.

On 2026-09-22, against a fresh export of `Submissions` (434 rows) and the
unchanged `Historical` tab (742 rows, frozen by definition — it is an archive
of the old Form and does not need re-exporting):

```
SQL vs oracle (is the port faithful?)
  ✔ SQL ↔ oracle: identical
Oracle vs production (is the export complete?)
  ✔ oracle ↔ production: identical
  ✔ SQL ↔ production: identical

✔ PARITY HOLDS — the SQL benchmark reproduces production exactly.
```

The new backend computes the same numbers impostor.pm serves today, to the
euro, over the entire real dataset. This was the migration's main risk and it
is closed.

Getting here took two fixes, both recorded in DECISIONS.md: the export-parsing
bug (formatted cells read a hundredfold too large) and, once that was gone,
a stale export — which simply needed re-exporting.

### Impact of the clean-up, for the record

`node scripts/verify-parity.mjs --clean` on the same data:

```
dropped:  150   (138 not-portugal, 10 monthly-or-junk, 2 above €200k)
repaired: 6     (18→18000, 24→24000, 24→24000, 35→35000, 62→62000, 70→70000)
overall.n: 1033 → 1021
overall.p10: 25 000 → 25 200
overall.p75: 60 000 → 61 000
```

Small and defensible. When the cutover happens these figures change visibly on
the site, so it is worth a line to the community rather than a silent shift.

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

1. ~~Ask the user to re-confirm decision C.~~ **Done 2026-09-22: confirmed,
   both high rows go.** The existing `> 200 000` rule already implements it;
   no code change was required.

   Note for whoever runs the export: the Google Drive connector CANNOT reach
   this Sheet. Searching by id and by title returns only old `.xlsx` copies
   owned by jnavero.92@gmail.com and one shared by a third party — the
   connector is authenticated as an account that does not own
   `19qBJIJjNS8QmBSowtDyCUYq32mIxyNOR4yWpiMpJGos`. The export has to be done
   from the browser, or the connector reconnected to the owning account.
2. **Re-export and re-run `npm run parity`** to close the count gap formally
   (432 live vs 428 in the export). Do it back to back; it drifts within hours.
3. **Then step 2 of the runbook** in `db/README.md`: create the Supabase
   project, apply `db/sql/`, deploy to a preview URL. Needs the user's Supabase
   credentials; nothing here has ever run against a real database, only PGlite.
4. **The dual-write change to the frontend** (step 3) is the largest remaining
   piece of code and has not been started. It touches
   `public/salary-compass/index.html`, which is guarded by the
   "byte-identical to the migrated original" assertion in
   `scripts/validate-production.mjs` — update both in the same commit.

Claude's session ended here at 98% of the 7-day quota. The threshold in
`~/.agents/failover/config.json` was raised from 85 to 95 mid-session at the
user's request (backup in `backups/config.json.pre-raise-2026-09-18`); it is
worth putting back. Everything is committed and pushed, so nothing is at risk.

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
