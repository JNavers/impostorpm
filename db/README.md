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
| Rows | 430 submissions, 32 completed surveys, 88 contacts, 742 historical |
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
  _lib.js                 validation, PostgREST client, Turnstile, rate limit
  _email-templates.js     extracted from functions/api/salary-compass-email.js
```

### Running it

```bash
cd db && npm install
npm test     # 47 tests, no network, no credentials
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

Against synthetic data, (1) vs (2) already passes: 20 seeded random datasets
plus a hand-written edge-case set. The half that needs the real export is (3).

---

## Findings

Things found while reading `Code.gs` that need a decision. None are fixed here:
the migration reproduces current behaviour exactly, and each of these is a
separate, deliberate change afterwards.

**1. `parseSalary` truncates European thousands separators.** It uses
`parseInt` after stripping spaces and commas, so `"50.000"` reads as **50**,
not 50 000. A row typed with a dot is in the benchmark today as a €50 salary
— below the `> 0` filter's reach and dragging every percentile down. The
importer reproduces this so parity holds; `npm run parity` will show how many
rows are affected. Fix it after the cutover, as a data correction with its own
announcement, not as a silent side effect.

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

**7. The cron scripts cannot be verified from the repo.** `result-emails.gs`
and `survey-reminders.gs` both have `DRY_RUN = true` in git, and there is no
clasp, so what production is actually sending is unknown from here. Check the
web editor before assuming either is live. `compass_pending_reminders` ports
the queue logic and is tested; the sending side is not written yet.

---

## Migration runbook

Five steps, no downtime, reversible at every point.

**1. Parity.** Create the Supabase project, apply `sql/`, import the exports,
run `npm run parity`. Do not proceed on a failure — explain every difference
first.

**2. Deploy the endpoints.** They ship with the site (same repo, same build).
Set in Cloudflare: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `HASH_SALT`,
`TURNSTILE_SECRET_KEY`, and bind a `COMPASS_RL` KV namespace. Verify against the
preview URL before it is wired into the page.

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
