# Salary Compass — backend migration

Moving the Salary Compass off Google Sheets + Apps Script and onto Supabase
Postgres, with the API as Cloudflare Pages Functions in this repo.

**Nothing here is live.** No Supabase project exists yet, the frontend still
talks to Apps Script, and production is untouched. This directory is the
schema, the API and the proof that the new benchmark reproduces the old one.

---

## Why

Measured against production on 2026-09-18:

| | Today |
|---|---|
| Rows | ~430 submissions, ~32 completed surveys, ~88 contacts, 742 historical |
| `GET` percentiles | **1.06 s** warm, **3.33 s** cold, for 3.4 kB |
| Write path | `mode: 'no-cors'` — the browser **cannot read the response** |
| Auth on writes | none; `doPost` accepts anonymous JSON from anyone |
| Concurrency | one global 5 s `LockService` lock; `update` does ~40 single-cell writes |

The two that matter are the write path and the auth. A failed write is
invisible to the page and nothing retries, so nobody can say how many of those
430 rows should have been more. And an unauthenticated public write endpoint
means the benchmark can be poisoned by a loop, with no IP, user agent or
session recorded to clean it up afterwards.

## What is here

```
db/
  sql/001_schema.sql      tables, constraints, indexes
  sql/002_benchmark.sql   the percentile computation, ported from Code.gs
  sql/003_api.sql         the RPCs the API calls
  sql/004_rls.sql         row level security (deny by default)
  scripts/                test harness + import + the parity gate
  fixtures/               where the Sheet exports go (git-ignored)

functions/api/compass/
  benchmark.js            GET  — replaces doGet()
  submissions.js          POST — replaces action=create
  submissions/[id].js     PATCH— replaces action=update
  contacts.js             POST — replaces action=email_only
  cron.js                 POST — replaces the two Apps Script time triggers
  _lib.js                 validation, PostgREST client, Turnstile, rate limit
  _email-templates.js     extracted from functions/api/salary-compass-email.js
  _senders.js             the deferred result email and the two survey nudges
```

### Running it

```bash
cd db && npm install
npm test     # 77 tests, no network, no credentials
npm run seed # build a local db with synthetic data and print the benchmark
```

The tests run against **PGlite** — real Postgres 17 compiled to WASM, in
process. No Docker, no server, no Supabase project. The SQL under `sql/` is the
same SQL that will be applied to Supabase; it avoids `citext` and `pgcrypto`
specifically so that what is tested locally is what runs in production.

---

## The parity gate

**Do not migrate until this passes.** It is the one step that protects the
numbers already published on impostor.pm.

```bash
# 1. In the Sheet: File → Download → CSV, once per tab
#    → db/fixtures/submissions.csv
#    → db/fixtures/historical.csv
# 2.
cd db && npm run parity
```

It computes the benchmark three ways and requires all three to agree to the
euro:

1. **SQL** — what the new backend will serve
2. **Oracle** — a literal JS port of `Code.gs` (`scripts/lib/legacy-benchmark.mjs`)
3. **Production** — a live `GET` on the Apps Script endpoint

(1) vs (2) proves the port is faithful. (2) vs (3) proves the export is
complete — without it, a "correct" port could be correct against a fixture that
does not match the Sheet.

**Status as of 2026-09-18, against the real exports: (1) vs (2) is identical.**
The SQL port reproduces the Apps Script on production data, which was this
migration's main risk and is now closed.

(2) vs (3) shows small residual differences whose tell is `overall.n` 1030 vs
1031 — production simply has more rows than the export does (the live counter
read 432 submissions against 428 in the CSV). People keep answering the survey.
Re-export and re-run back to back to close it; expect it to drift again within
hours.

`--clean` applies the historical clean-up (decisions A–C) and reports its impact
instead of passing or failing. It is a separate mode on purpose: the default
stays raw so the gate keeps comparing like with like. Running only the clean
mode would quietly retire the control.

---

## Findings

Things found while reading `Code.gs` that need a decision. None are fixed here:
the migration reproduces current behaviour exactly, and each of these is a
separate, deliberate change afterwards.

**1. Reading the CSV export is not reading the Sheet.** Sheets serialises what
a cell DISPLAYS, so a cell holding 42 000 in the Portuguese locale exports as
`"42 000,00"`. `Code.gs`'s `parseSalary` strips spaces and commas without
treating either as what it is, which turns that into 4 200 000 — a hundredfold
error on 17 of the 604 Portugal rows. **Production is not affected**: Apps
Script reads through `getValues()`, which returns the underlying number. Only
the export path was ever wrong, and `parseSalaryFromExport()` now handles it.
Worth stating plainly because the phantom millions were reported as corrupt
data before the cause was found, and a data-deletion decision was taken on
them. Where a number matters, check the raw cell text first.

**1b. Some genuinely tiny salaries ARE in the published benchmark.** Distinct
from the above: six Portugal rows hold 18, 24, 24, 35, 62 and 70 as actual cell
values, not as a formatting artefact. Those are in production's percentiles
right now as €18 salaries. The form took salary as free text, and the
respondents meant thousands. Decision B in `docs/agent/DECISIONS.md` repairs
them by ×1000; the bound is 100, not 1000, because `450` (with 48 000 in its
with-perks column) means 45 000, not 450 000.

**2. Float64 rounding is load-bearing.** `percentile()` interpolates in
JavaScript floats and rounds. Postgres `numeric` is exact, and on a `.5`
boundary the two disagree by €1 — caught by the seeded parity test on
`roles.APM.p90`. `compass_percentile` therefore computes in `double precision`
and uses `floor(x + 0.5)`, because `round(double precision)` is banker's
rounding in Postgres (`round(2.5) = 2`) while `Math.round(2.5) = 3`.

**3. District stats aggregate total comp, not base.** The comment in `Code.gs`
says "aggregate base salary by district"; the code pushes
`total > 0 ? total : base`. The SQL matches the code. Worth deciding which was
intended — it changes every district median.

**4. `mapHistoricalRole` has no entry for `11-`.** Whatever role sits at that
index in the old Form counts toward `overall` but lands in no role bucket. If
those rows exist, they are silently half-counted.

**5. The Sheet holds rows the new constraints reject.** Rows predating the
current validation (total comp below base, PMs with no district). `npm run
parity` imports with those two constraints dropped and lists what would have
been refused. Decide before the cutover — they are in the published benchmark
right now.

**6. Column 32 is `_reserved`.** Dead weight from an older schema, not carried
over.

**7. The cron scripts are almost certainly live, despite the repo.**
`result-emails.gs` and `survey-reminders.gs` both carry `DRY_RUN = true` in git
and there is no clasp, so the repo cannot answer this. But a live
`?action=debug` shows the `Emails` sheet carrying `Reminder 1 Sent`,
`Reminder 2 Sent` and `Result Email Sent` — the columns whose manual creation
is the documented setup step for those scripts. Plan for "they are sending".
`compass_pending_reminders` ports the queue logic and is tested; the sending
side is not written yet.

**8. The historical `Role` column holds salary bands, not roles.** It is headed
`Role`, so the tolerant matcher resolves it, but its values are `40K-50K`,
`30K-40K`, `0-10K`, one `#REF!`, and it is empty in 681 of 742 rows.
`mapHistoricalRole()` therefore returns NULL for effectively every historical
row, which means **the published per-role percentiles come from the ~430
submissions alone**. The 742 historical rows feed `overall` and the
years-of-experience cuts and no role bucket at all. If the old Form captured a
role somewhere else, recovering it would roughly double the sample behind every
role cut.

---

## Secrets, and the one that cannot be rotated freely

All four are stored as Cloudflare **Secrets**, not Text variables: a Text var
can be read back from the dashboard and appears in build logs, and the
`service_role` key bypasses every RLS policy. Once written they cannot be read
back, which is the point.

| Secret | Rotatable? | Consequence of rotating |
|---|---|---|
| `SUPABASE_URL` | n/a | not a secret, just kept together with them |
| `SUPABASE_SERVICE_ROLE_KEY` | freely | rotate in Supabase, push again |
| `CRON_SECRET` | freely | update the Cron Triggers to match |
| `HASH_SALT` | **no — see below** | silently breaks provenance grouping |

### HASH_SALT

`ip_hash` and `ua_hash` are SHA-256 over `salt:value`, truncated. The salt is
what makes them irreversible: without it the hash of an IPv4 address is
trivially brute-forced, since there are only four billion of them.

The catch is that **the salt is part of the hash**. Rotate it and every row
written afterwards hashes the same IP to a different value than every row
written before, so the two groups stop comparing. The question these columns
exist to answer — "did these 400 rows all come from one address?" — silently
starts returning no across the boundary, with no error and nothing in the data
that looks wrong.

That trade-off is deliberate: it is what buys irreversibility. But it means:

- **Do not rotate `HASH_SALT` once rows carry provenance.** Treat it as
  permanent for the life of the dataset.
- It exists only in Cloudflare and cannot be read back. It was generated at
  setup and never written down anywhere else, on purpose.
- If it ever has to change — a suspected leak, say — the honest fix is to
  re-hash nothing and accept the boundary, recording the date it moved so
  anyone querying provenance knows to treat before and after separately.

If the salt is lost (project deleted, secret cleared) the existing hashes stay
valid and comparable with each other; only new rows are cut off. Losing it is
therefore recoverable-ish, rotating it for no reason is not worth it.

---

## The scheduled emails

`cron.js` replaces the two Apps Script time-driven triggers. It is an
authenticated endpoint rather than a `scheduled()` handler so it can be run by
hand:

```bash
# who WOULD be emailed right now, without sending anything
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "https://www.impostor.pm/api/compass/cron?kind=result&dry=1"
```

That is what `DRY_RUN` was for in the originals — except those required editing
and redeploying the source to find out, which is why the repo copies say
`DRY_RUN = true` while production is almost certainly sending. Here the mode is
a query parameter and cannot be left the wrong way round by accident.

Three kinds: `result` (7 min after the gate capture), `reminder_1` (24 h) and
`reminder_2` (72 h, and only after reminder 1 has actually gone out). Set
`CRON_SECRET` in Cloudflare and point three Cron Triggers at them.

Every attempt is written to `email_log`, and only a success stamps the contact —
so a failed send comes round again on the next run instead of being lost. The
Sheet kept one "Email Sent" cell per contact, so a retry erased the record of
the failure it was retrying.

---

## Migration runbook

Five steps, no downtime, reversible at every point.

**1. Parity.** Create the Supabase project, apply `sql/`, import the exports,
run `npm run parity`. Do not proceed on a failure — explain every difference
first.

**2. Deploy the endpoints.** DONE 2026-09-22. They ship with the site (same
repo, same build). `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `HASH_SALT` and
`CRON_SECRET` are set as SECRETS on both Production and Preview, pushed by
`db/scripts/push-cloudflare-env.mjs` (values live in the git-ignored
`db/.env.cloudflare`).

Still optional, both degrade gracefully and say so in the response rather than
pretending to be protected:
  - `COMPASS_RL` KV binding for the per-IP rate limit. The namespace exists
    (`b885768ad5834c28b37a3de35db87ce3`, "compass-rate-limit") but the binding
    has to be added in the dashboard — Settings → Bindings — because this Pages
    project builds from Git and adding a wrangler.toml would change how it
    builds.
  - `TURNSTILE_SECRET_KEY` for the anti-bot check.

**3. Dual-write, 1–2 weeks.** The page posts to both backends; reads stay on
Apps Script. Compare the two datasets daily. This is calendar time, not work.

**4. Switch the read** to `/api/compass/benchmark`. Apps Script keeps taking
writes as the safety net.

**5. Cut Apps Script.** The Sheet becomes a read-only archive. Then:
fold `functions/api/salary-compass-email.js` into `contacts.js` (it is left
untouched for now precisely because it serves the live page), and move the two
cron scripts to Cloudflare Cron Triggers or `pg_cron`.

Rollback at any point is one constant in `public/salary-compass/index.html`.

> Step 3 will need `scripts/validate-production.mjs` updated in the same commit:
> its "salary-compass is byte-identical to the migrated original" check fails
> the moment that file is edited.

---

## Notes on the design

**Why `survey jsonb` and not 35 columns.** `Code.gs` writes 44 positional
columns. Eight feed the benchmark and are typed here with constraints; the rest
are survey answers nothing aggregates yet. Keeping them schemaless means adding
a survey question stops being a schema migration, and the GIN index keeps them
queryable for the dashboard cuts.

**Why the browser never talks to Supabase.** The anon key ships in the page.
An anon write policy would reproduce exactly the hole this migration exists to
close, with extra steps. So RLS is on with **no** permissive policies, the
service role key lives only in the Worker, and the single public read
(`benchmark_cache`) is granted explicitly rather than by accident.

**Why no `@supabase/supabase-js`.** Five REST calls between four endpoints.
PostgREST is plain HTTP; the SDK would add ~40 kB to every cold start to save
about thirty lines.
