# Decisions

Durable technical decisions for this repo. Newest first.

---

## 2026-09-22 — Surveys resume on the original comparison; the Sheet id is kept, not unique

The user asked for a way for people who already compared to complete the
survey without filling the comparison again (which duplicates their salary).

- **The personal link already existed** (`?survey=1&sid=…`, in the result and
  reminder emails) and binds the survey to the original row. Kept as the one
  mechanism; the manual path is a Sheet menu that builds the same link
  (`survey-link.gs`), so hand-sent and emailed links cannot diverge.
- **A survey with no comparison is refused, not accepted.** The Sheet dropped
  it silently while the page showed success. Refusing means some visitors are
  sent to the form, which is the duplicate risk, but the alternative was data
  loss that looked like success.
- **`legacy_id` is not unique**, and repeat comparisons keep sharing one id.
  A fresh id per comparison was implemented and reverted in the same session:
  the shared id is the only evidence that 137 rows are 50 people, and step 4
  has to decide how those count. Which of a person's comparisons is "theirs"
  (first, last, none) is the user's call, not a side effect of a bug fix.
- The survey lands on the **oldest** row with the id, to match
  `updateSubmission_` exactly, so both stores agree on which row is enriched.

---

## 2026-09-18 (later) — CORRECTION: the "millions" were a reading bug, not bad data

**This invalidates the premise of part of decision C below. Read it first.**

The Historical export contains cells like `"42 000,00"` — Portuguese locale,
space for thousands, comma for decimals. Code.gs's `parseSalary` strips spaces
and commas without understanding either, so reading the CSV turned 42 000 into
**4 200 000**. Seventeen of the 604 Portugal rows were inflated a hundredfold.

**Production was never affected.** Apps Script reads the Sheet through
`getValues()`, which returns the underlying number, not the formatted text.
Only the export path was broken.

The consequence is not academic. Those phantom millions were reported to the
user as corrupted data, and on that basis they decided to drop 18 rows. The
rows were fine: 15 500, 42 000, 52 000, 55 000 and so on — ordinary Portuguese
PM salaries. The reader was broken, not the respondents.

`parseSalaryFromExport()` now reads exports correctly; `parseSalaryLegacy()` is
kept as the regression witness and as the documented Code.gs behaviour.

**What decision C actually removes, with correct parsing:** 2 rows above
€200 000 (225 000 and 350 000 — the two that always looked genuine) and 10 rows
below €10 000 (monthly pay in an annual field, plus incoherent ones). Twelve
Portugal rows, not 27. The thresholds did not change; the data they see did.

**Re-confirmed by the user on 2026-09-22**, having been shown that the two are
now the only high rows: *"elimina esas dos filas de 225000 y 350000"*. So
decision C stands unchanged, and the existing `> 200 000` rule already
implements it — no code change was needed, only the confirmation that the rule
was still wanted once its premise had been corrected.

**Lesson for the rest of the migration:** a CSV export is not the Sheet. Where a
number matters, check the raw cell text before concluding the data is bad.

---

## 2026-09-18 — Historical import: Portugal only, repair the "18 means 18K" rows, drop the rest

> Read A, B and C together. C supersedes part of B: the million-euro rows are
> DROPPED, not repaired. B is kept because its analysis explains what the data
> actually is, and because it records a wrong rule caught before it reached code.

Two product decisions from the user (Javi), in his words: *"de momento migra
solo los datos históricos que indiquen que la residencia es en Portugal ya que
el Salary Compass actual es para el mercado portugués"* and *"en la época de
los datos históricos el campo de salario era free text… aquellos que pusieron
18, 24, o 35 estoy seguro que querían poner K, o sea miles"*.

**Decision A — import only `Where do you reside? = Portugal`.** 604 of the 742
historical rows. This is not a filter change to the benchmark: `compass_entries`
already restricts to Portugal, so the aggregate numbers do not move. It changes
what is *stored*. It also removes the row that blocked the import (a Chilean
`3120000000` overflowing `integer`), so widening to `bigint` is no longer
required — though it remains the more conservative option if the archive should
ever hold non-Portugal rows again.

**Decision B — repair the mistyped salaries. A single multiplier is WRONG.**

An earlier draft of this entry said "multiply the sub-1000 values by 1000".
That is wrong and was corrected the same day, before any code was written.
The user spotted it: the row reading `450` has `48000` in the with-perks
column, so it means **45 000**, not 450 000. Anchoring on a fixed multiplier
would have invented a €450 000 salary.

Three distinct corruption patterns exist in the data. **Only the first is
repaired** — see decision C for what happens to the other two:

- **Values under ~100** (18, 24, 24, 35, 62, 70): the respondent wrote the
  figure in thousands. `18` -> 18 000. x1000. **<- the only repair implemented.**
- **Values >= 1 000 000** (16 rows, 1 550 000 ... 5 600 000): almost certainly a
  European-format entry such as `55 000,00` flattened by `parseSalary`, which
  strips spaces and commas without reconstructing the number, yielding
  `5500000`. Dividing by 100 puts all sixteen in the 15 500 - 56 000 range, and
  their with-perks totals scale consistently (ratio 1.00-1.34), which rules out
  random typos. **Plausible but unproven -> dropped under decision C, not
  repaired.**
- **Values from 100 to 9 999**: monthly pay quoted in an annual field
  (`3000 / perks 31646`), plus some incoherent rows (`3150 / perks 500`).
  **Dropped under decision C.**

**The lesson, if a repair rule is ever extended:** anchor on the with-perks
total of the same row. It is a second, independently-typed figure, and it is
what exposed the `450` case. A blanket multiplier cannot work when three
different corruptions coexist. Log every repaired row: this changes published
figures and must be defensible one row at a time.

**Why this is a real exception to the parity rule.** DECISIONS.md otherwise
says the migration must reproduce today's published numbers exactly. This
deliberately does not: it corrects them. It is allowed because the user
explicitly asked for it with knowledge of the consequence, and because the
current values are indefensible (an 18 € salary in a compensation benchmark).
It must therefore be treated as a **published-number change**, not as a silent
migration detail — the parity gate will now legitimately fail against
production, and that failure is expected rather than a stop.

**Decision C — DROP the corrupted historical rows entirely; do not keep them.**

The user's call, 2026-09-18, after being shown the option to merely flag them:
*"en este caso quiero que elimines los outliers. porque son datos históricos
que eran recogidos con un proceso no muy limpio. de ahí que los quiera
eliminar. los datos que han sido tomados del Salary Compass 'submission' ya son
más seguros."*

This supersedes an earlier draft of this entry that proposed setting
`outlier = true` and keeping the rows. The user rejected that explicitly. The
reasoning is a provenance judgement, not a statistical one: the old Google Form
took salary as free text with no validation, so a value that looks wrong
probably *is* wrong rather than merely extreme. The `submissions` table, which
goes through the validated API, is trusted and is **not** subject to any of
this cleaning.

**What is dropped (27 rows of the 603 Portugal rows, 4.5%):**

- **18 rows with base > 200 000** — the 16 in the millions plus 225 000 and
  350 000. The ÷100 hypothesis was plausible but unproven, and the user was
  not confident in either.
- **9 rows with base between 100 and 9 999** — the monthly-pay pattern
  (`3000 / perks 31646`, `1275 / perks 21197`, …) plus the incoherent ones
  (`3150 / perks 500`, `150 / perks 100`) and `450 / perks 48000`.
  **This group is an inference, not an explicit instruction.** The user named
  only the 18 high rows, but the stated criterion — dirty collection process,
  not confident, therefore remove — applies to these identically. Flag it to
  the user; it is the one thing here they have not said in so many words.

**What is repaired, not dropped:** the 6 rows with base < 100 (18, 24, 24, 35,
62, 70) are multiplied by 1000. These are kept because the user expressed
certainty about them specifically (*"estoy seguro que querían poner K"*), in
contrast to everything above.

**Measured effect on the historical base-salary percentiles:**

| | n | p10 | p25 | p50 | p75 | p90 |
|---|---|---|---|---|---|---|
| today | 603 | 25 000 | 35 000 | 45 100 | 60 000 | 84 800 |
| cleaned | 576 | 25 200 | 35 000 | 45 050 | 60 000 | **77 000** |

Resulting range: 12 420 – 200 000, all plausible. The median is untouched; the
entire correction lands in the upper tail.

**Implementation note.** Dropping means the `historical` table no longer mirrors
the Sheet, so the exclusions must be recorded somewhere: have the importer
write every dropped row, with its reason, to a log file (git-ignored — it holds
salary data). "We removed 27 rows and here is exactly which" has to remain
answerable after the fact.

---

## 2026-09-18 — Salary Compass backend: Supabase Postgres + Pages Functions

**Decision.** Replace the Google Sheet + Apps Script backend with Supabase
Postgres, with the API as Cloudflare Pages Functions in this repo.

**Why.** The volume is tiny (1 172 rows), so this is not a scaling decision. It
is about two defects that cannot be fixed in place: writes go out with
`mode: 'no-cors'`, so the page cannot distinguish a rejected write from an
accepted one and nothing retries; and `doPost` is a public unauthenticated
endpoint with no IP or user agent recorded, so the benchmark can be poisoned
with no way to identify the rows afterwards. Supabase was chosen over
alternatives partly because it is already in use in the Porra and Rellano
projects, so it adds no new stack to learn.

**Rejected.** Cloudflare D1 — fits the edge and is cheaper to operate, but
SQLite offers no indexed `jsonb` or materialized views, and it is used nowhere
else. Airtable/Baserow — swaps one spreadsheet for another; fixes neither auth
nor latency. Keeping Sheets behind a proxy — fixes the auth hole only.

---

## 2026-09-18 — The benchmark port must match float64, not be arithmetically correct

**Decision.** `compass_percentile` computes in `double precision` and rounds
with `floor(x + 0.5)`, rather than using `numeric` or `percentile_cont`.

**Why.** Apps Script interpolates percentiles in JavaScript float64. Postgres
`numeric` is exact, so on a `.5` boundary the two disagree by €1 — caught by a
seeded random parity test on `roles.APM.p90`. Those percentiles are already
published on impostor.pm, and a migration that silently moves a public number
is not acceptable even when the new number is the more correct one. Parity
first; corrections afterwards, as their own change. `floor(x + 0.5)` is used
because `round()` on `double precision` in Postgres is banker's rounding
(`round(2.5) = 2`) while JS `Math.round(2.5) = 3`.

**Consequence.** The whole of `db/sql/002_benchmark.sql` is a deliberate port,
not an improvement. Its oddities are commented `MATCHES Code.gs`. Improving any
of them changes published numbers.

---

## 2026-09-18 — Benchmark inputs are typed columns; survey answers are jsonb

**Decision.** Type the eight fields the benchmark computes over; keep the ~35
long-survey answers in a `survey jsonb` column with a GIN index.

**Why.** `Code.gs` writes 44 positional columns, and the survey changes between
versions. Typing all of them would make adding a survey question a schema
migration. The aggregate path stays fast and constrained; the ad-hoc path stays
flexible and still queryable for the dashboard cuts.

---

## 2026-09-18 — The browser never talks to Supabase

**Decision.** RLS enabled on every table with **no** permissive policies. The
service role key lives only in the Pages Function. The single public read
(`benchmark_cache`) is granted to `anon` explicitly.

**Why.** The Supabase anon key ships in the page. An anon write policy would
reproduce exactly the unauthenticated public write path this migration exists
to close, with extra steps. Denying by default means a future `create policy
... to anon` has to be argued for on those terms rather than added by habit.

---

## 2026-09-18 — Tests run on PGlite, and the schema avoids extensions to allow it

**Decision.** The test harness is PGlite (Postgres 17 compiled to WASM,
in-process). The schema uses no extensions — no `citext`, no `pgcrypto`.

**Why.** Docker is not running on this machine, so `supabase start` is not
available. PGlite gives real Postgres semantics with no daemon, no network and
no credentials, which is what allows the whole backend to be developed and
proven without a Supabase project or any risk of touching production. Avoiding
extensions PGlite lacks is what keeps the locally-tested SQL identical to the
SQL that will run on Supabase; emails use a lower-case `CHECK` instead of
`citext`, and `gen_random_uuid()` has been in core since PG13.
