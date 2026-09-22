# Status

Last updated: 2026-09-22 (Claude, session c49ed8fc — stopped at 99% of the
7-day quota, mid-diagnosis of a new bug; see "NEW TASK" below)

## Objective

Move the Salary Compass backend off Google Sheets + Apps Script onto Supabase
Postgres, with the API as Cloudflare Pages Functions in this repo.

Steps 1–3 are DONE and IN PRODUCTION (PR #5 merged 2026-09-22 as b0025d4).
Apps Script is still authoritative for reads; every write now goes to both.

## Where the work lives

`main` holds steps 1–3 (PR #5). The branch `worktree-compass-backend-migration`
is ahead of main by the cron Worker and docs (last pushed 26fcef9) — those are
deployed but NOT merged; open a small PR to bring them into main. Developed in the git worktree at
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

- Step 4 (switch reads to /api/compass/benchmark) and step 5 (cut Apps Script).
  Wait 1–2 weeks of dual-write first; watch `compass_mirror_ok` vs
  `compass_mirror_failed` in PostHog.
- Merge the branch's remaining commits (cron Worker, docs) into main.
- `RESEND_API_KEY` is missing from the Pages Preview environment (set in Prod).

## NEW TASK (2026-09-22, not started) — "Get my dashboard" does nothing

Users have reported for a month that the final survey button does nothing
(Safari on macOS named once; two emails 11–12 Aug 2026 with screenshots of the
"Confirm your email" step, valid email filled in, button still reading "Get my
dashboard"). NOT fixed — the session hit 99% quota; diagnosis only, read-only,
against origin/main's public/salary-compass/index.html.

Findings so far:

- Handler: `$('#full-survey-form').on('submit', …)` (~line 4325 on main).
- The two error paths that restore the button both SHOW a message: an `alert`
  on the survey submit, or text in `#survey-email-error` on the email step.
  Users report no message, so those are unlikely.
- The button text stayed "Get my dashboard" in the screenshots, so the handler
  returned BEFORE `$btn.prop('disabled', true)` / "Submitting…".
- The only silent early return before that point is the required-fields gate:
  `missingRequiredFields(surveyChapter)` → `flagMissingFields(...)` → focus +
  scrollIntoView on the first missing field → `return`. On the final email
  step, a required field flagged on an earlier sub-step is not visible, so the
  user sees nothing happen.
  Hypothesis: a required field (candidates: `survey-top-skills` chip logic,
  `survey-hybrid-days` + frequency, a select Safari leaves empty) evaluates
  empty on the last step.

Decisive next step, BEFORE touching code: query PostHog for
`comp_survey_submit_blocked` (fires only on that gate, with `missing_count`).
If it fires for these users, the fix is to (a) make the gate report WHICH field
and navigate back to its chapter/sub-step, and (b) find why that field reads
empty. Reproduce in Safari, not only Chrome.

The page is the delicate file (see "Watch out"); validate-production now
compares served vs source, so no byte-count to update.

## Blocker — none

Step 3 was verified end to end on 2026-09-22 against preview
`f0cedb34.impostorpm-site.pages.dev`:

- **Comparison, through the real form in a browser** → row in Supabase with the
  right salary, district, perception and a hashed `ip_hash`.
- **Survey** → `PATCH` landed on the same row the comparison created.
- **Email capture** → covered by `smoke-test-preview.mjs`.

`protection: {turnstile: verified, rateLimit: enforced}` on the write, so both
protections are live rather than skipped.

Every test row was deleted afterwards; counts are back to 434 / 592 / 33 with
no rows outside the import.

## Test state

`cd db && npm test` → **100 passing, 0 failing** (as of 26fcef9). `npm run build`
succeeds and copies the page through byte-identical.

Deployed and verified live: the cron Worker `compass-cron` fired `*/5` and
returned ok against production; all three job kinds pass a dry run; a wrong or
missing CRON_SECRET returns 401. Turnstile verified + rate limit enforced on
writes.

## Next action

1. The "Get my dashboard" bug above: PostHog `comp_survey_submit_blocked` first.
2. Keep dual-write running; then step 4, with a public note about the number
   changes (n 1033 → 1021, p75 60 000 → 61 000).
3. Put `claude.threshold` in `~/.agents/failover/config.json` back to 85
   (backup: `backups/config.json.pre-raise-2026-09-18`).

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
