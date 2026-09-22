-- ════════════════════════════════════════════════════════════════════
--  Salary Compass — full schema, ready to paste into the Supabase SQL Editor
--
--  GENERATED FILE. Do not edit: it is db/sql/001..004 concatenated in order.
--  Regenerate with:  node db/scripts/build-apply-all.mjs
--
--  Safe to run more than once: every statement is CREATE ... IF NOT EXISTS or
--  CREATE OR REPLACE, so re-applying it after a change is the normal workflow
--  rather than a recovery step.
--
--  It creates no data and touches nothing outside the public schema.
-- ════════════════════════════════════════════════════════════════════


-- ══════════ 001_schema.sql ══════════

-- ════════════════════════════════════════════════════════════════════
--  Salary Compass — schema
--
--  Replaces the Google Sheet (tabs: Submissions / Emails / Historical)
--  that apps-script/salary-compass/Code.gs reads and writes today.
--
--  Two rules shaped this file:
--
--   1. Only the columns the benchmark actually computes over are typed.
--      Code.gs writes 44 positional columns; 8 of them feed percentiles
--      and the other ~35 are survey answers nobody aggregates yet. Those
--      go in `survey jsonb`, so adding a survey question stops being a
--      schema migration.
--
--   2. No extensions. citext and pgcrypto are unavailable in PGlite (the
--      local test harness) and would make what we test locally differ
--      from what runs on Supabase. Emails are stored lower-cased behind a
--      CHECK instead, and gen_random_uuid() has been in core since PG13.
-- ════════════════════════════════════════════════════════════════════

-- ── Enumerated domains ──
-- These mirror ALLOWED_ROLES / ALLOWED_DISTRICTS in Code.gs exactly. They are
-- CHECK constraints rather than native enums so that adding a value is an
-- ordinary migration and never rewrites the table.

create table if not exists submissions (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- ── Benchmark inputs (the comparison step) ──
  base_salary       integer,
  total_comp        integer,
  role              text not null,
  yoe               numeric(4,1),
  district          text,
  perception_guess  integer,

  -- ── Funnel state ──
  -- Mirrors Submissions column 21 ("Full Survey" = "Yes"/"No"). A row is born
  -- at the comparison step and enriched when the long survey is completed.
  full_survey       boolean not null default false,
  survey_at         timestamptz,

  -- ── The long survey, unaggregated ──
  survey            jsonb not null default '{}'::jsonb,

  -- ── Provenance ──
  -- None of this exists in the Sheet today, which is precisely why a poisoned
  -- dataset could not be cleaned up after the fact. Hashed, never raw: we can
  -- group by origin without storing anything that identifies a person.
  source            text,
  ip_hash           text,
  ua_hash           text,

  constraint submissions_role_allowed check (role in (
    'APM', 'PM', 'Senior PM', 'Lead PM', 'Principal PM',
    'Director of Product', 'Head of Product', 'VP of Product', 'CPO',
    'Not a PM'
  )),
  constraint submissions_district_allowed check (district is null or district in (
    'Aveiro', 'Beja', 'Braga', 'Bragança', 'Castelo Branco', 'Coimbra',
    'Évora', 'Faro', 'Guarda', 'Leiria', 'Lisboa', 'Portalegre', 'Porto',
    'Santarém', 'Setúbal', 'Viana do Castelo', 'Vila Real', 'Viseu',
    'Açores', 'Madeira'
  )),

  -- Ranges lifted from cleanMoney_/cleanNumber_ call sites in Code.gs, so the
  -- database rejects exactly what the Apps Script validator rejects today.
  constraint submissions_base_range   check (base_salary is null or (base_salary >= 1 and base_salary <= 1000000)),
  constraint submissions_total_range  check (total_comp  is null or (total_comp  >= 1 and total_comp  <= 1500000)),
  constraint submissions_total_gte_base check (
    total_comp is null or base_salary is null or total_comp >= base_salary
  ),
  constraint submissions_yoe_range    check (yoe is null or (yoe >= 0 and yoe <= 50)),
  constraint submissions_perception_range check (
    perception_guess is null or (perception_guess between 0 and 100)
  ),

  -- Code.gs enforces this in createSubmission_: a real PM must carry years and
  -- a district, a "Not a PM" lead carries neither and is excluded from stats.
  constraint submissions_pm_needs_profile check (
    role = 'Not a PM' or (yoe is not null and district is not null)
  )
);

comment on column submissions.survey is
  'Long-survey answers (gender, company, industry, perks, equity, …). Kept schemaless on purpose: these are reported on ad hoc and change between survey versions.';

-- ── Contacts (the "Emails" tab) ──
create table if not exists contacts (
  id                uuid primary key default gen_random_uuid(),
  submission_id     uuid references submissions(id) on delete set null,
  created_at        timestamptz not null default now(),
  email             text not null,
  source            text not null,
  report_optin      boolean not null default false,
  newsletter_optin  boolean not null default false,
  percentile        integer,
  token             uuid not null default gen_random_uuid(),

  -- Reminder/result-email bookkeeping. In the Sheet these are columns K, L and
  -- M, added by hand per the setup comments in survey-reminders.gs and
  -- result-emails.gs; here they are part of the schema.
  result_email_at   timestamptz,
  reminder_1_at     timestamptz,
  reminder_2_at     timestamptz,

  constraint contacts_email_lowercase check (email = lower(email)),
  constraint contacts_email_shape check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint contacts_source_allowed check (source in (
    'dashboard_waitlist', 'survey_inline', 'newsletter_popup',
    'footer_newsletter', 'email_gate', 'not_a_pm'
  )),
  constraint contacts_percentile_range check (percentile is null or (percentile between 0 and 100))
);

-- One contact row per email per source. The Sheet appends blindly, so the same
-- person filling the gate twice is two rows and the "emails" counter overstates
-- the list. This makes that impossible without losing the multi-source signal.
create unique index if not exists contacts_email_source_key on contacts (email, source);
create index if not exists contacts_submission_idx on contacts (submission_id);
create unique index if not exists contacts_token_key on contacts (token);

-- ── Email log ──
-- The Sheet keeps one "Email Sent"/"Email Error" pair per contact row, so a
-- retry overwrites the record of the first attempt. One row per send attempt.
create table if not exists email_log (
  id            bigint generated always as identity primary key,
  contact_id    uuid references contacts(id) on delete cascade,
  created_at    timestamptz not null default now(),
  kind          text not null,
  resend_id     text,
  ok            boolean not null,
  error         text,
  constraint email_log_kind_allowed check (kind in ('capture', 'result', 'reminder_1', 'reminder_2'))
);
create index if not exists email_log_contact_idx on email_log (contact_id, created_at desc);

-- ── Historical ──
-- The 742 rows exported from the old Google Form. Imported once and frozen:
-- nothing writes here again, which is why it carries no constraints beyond
-- what the benchmark needs. `outlier` and `country` are the two filters
-- computePercentiles() applies before using a row.
-- The money columns are bigint, not integer, and deliberately so. The clean
-- import (decisions A–C) drops everything implausible and would fit in an
-- integer comfortably — but the parity control imports the sheet RAW, and the
-- raw sheet contains a 3 120 000 000 entry that overflows int4. Narrowing this
-- would work right up until it silently disabled the one check that proves the
-- SQL port reproduces production.
create table if not exists historical (
  id            bigint generated always as identity primary key,
  country       text,
  base_salary   bigint,
  total_comp    bigint,
  role_raw      text,
  yoe_raw       text,
  outlier       boolean not null default false
);

-- ── Indexes for the benchmark ──
-- The benchmark scans every non-"Not a PM" row with a positive base salary.
-- A partial index keeps that scan off the rows it always discards.
create index if not exists submissions_benchmark_idx
  on submissions (role, yoe)
  where role <> 'Not a PM' and base_salary > 0;

create index if not exists submissions_district_idx
  on submissions (district)
  where district is not null and base_salary > 0;

create index if not exists submissions_created_idx on submissions (created_at desc);

-- Lets the dashboard cuts filter on survey answers without a sequential scan
-- once the survey table grows (industry, remote policy, gender, …).
create index if not exists submissions_survey_gin on submissions using gin (survey);

-- ── updated_at ──
create or replace function touch_updated_at() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists submissions_touch_updated_at on submissions;
create trigger submissions_touch_updated_at
  before update on submissions
  for each row execute function touch_updated_at();

-- ══════════ 002_benchmark.sql ══════════

-- ════════════════════════════════════════════════════════════════════
--  Salary Compass — benchmark computation
--
--  A line-by-line port of computePercentiles() in
--  apps-script/salary-compass/Code.gs. The goal is not "a better
--  benchmark": it is the SAME benchmark, to the euro, so that the cutover
--  cannot move a published number. Improvements come after parity, never
--  as part of it.
--
--  Everywhere this file looks odd, it is because Code.gs does something
--  odd and we are matching it deliberately. Those spots are commented
--  with "MATCHES Code.gs" so a future reader does not "fix" them and
--  silently change the public numbers.
-- ════════════════════════════════════════════════════════════════════

-- ── percentile() ──
-- MATCHES Code.gs: linear interpolation between neighbours, rounded to the
-- nearest integer, EXCEPT when the index lands exactly on an element, where the
-- raw value is returned unrounded. Note this is not percentile_cont(): that one
-- would not round, and the published p50 would shift by up to a euro.
--
-- The arithmetic runs in DOUBLE PRECISION, not numeric, and that is the whole
-- point of this function. Apps Script computes in JavaScript float64, where an
-- interpolated midpoint can land on 111168.49999999999 instead of 111168.5.
-- Postgres numeric is exact and would round that up, printing a salary one euro
-- above the one impostor.pm publishes today. Parity with production beats
-- being right: matching float64 is what keeps the cutover invisible. (A
-- seeded-random parity test caught exactly this, on roles.APM.p90.)
--
-- floor(x + 0.5) rather than round(): round(double precision) uses rint(), which
-- is banker's rounding (round-half-to-even), so round(2.5::float8) = 2 while
-- JS Math.round(2.5) = 3. floor(x + 0.5) is Math.round for the non-negative
-- values this ever sees.
create or replace function compass_percentile(sorted numeric[], p numeric)
returns numeric language plpgsql immutable as $$
declare
  n int := coalesce(array_length(sorted, 1), 0);
  k double precision; f int; c int; lo double precision; hi double precision;
begin
  if n = 0 then return 0; end if;
  k := (n - 1)::double precision * p::double precision / 100.0::double precision;
  f := floor(k);
  c := ceil(k);
  -- +1 because Postgres arrays are 1-indexed and the JS original is 0-indexed.
  if f = c then return sorted[f + 1]; end if;
  lo := sorted[f + 1]::double precision;
  hi := sorted[c + 1]::double precision;
  return floor(lo + (k - f::double precision) * (hi - lo) + 0.5::double precision)::numeric;
end;
$$;

-- ── pcts() ──
-- MATCHES Code.gs: values <= 0 are dropped BEFORE n is counted, and a bucket
-- under the minimum is returned zeroed with suppressed=true rather than
-- omitted — the client relies on the shape being present either way.
create or replace function compass_pcts(vals numeric[], min_n int)
returns jsonb language plpgsql immutable as $$
declare
  sorted numeric[];
  n int;
begin
  select array_agg(v order by v) into sorted
  from unnest(coalesce(vals, '{}'::numeric[])) as v
  where v > 0;

  n := coalesce(array_length(sorted, 1), 0);

  if n < min_n then
    return jsonb_build_object(
      'p10', 0, 'p25', 0, 'p50', 0, 'p75', 0, 'p90', 0,
      'n', n, 'suppressed', true
    );
  end if;

  return jsonb_build_object(
    'p10', compass_percentile(sorted, 10),
    'p25', compass_percentile(sorted, 25),
    'p50', compass_percentile(sorted, 50),
    'p75', compass_percentile(sorted, 75),
    'p90', compass_percentile(sorted, 90),
    'n',   n
  );
end;
$$;

-- ── Role bucketing ──
-- MATCHES mapSubmissionRole(): anything not listed maps to NULL, and a NULL
-- role still contributes to `overall` — it just never lands in a role bucket.
create or replace function compass_role_bucket(role text)
returns text language sql immutable as $$
  select case role
    when 'APM' then 'APM'
    when 'PM' then 'PM'
    when 'Senior PM' then 'Senior PM'
    when 'Lead PM' then 'Lead/Principal'
    when 'Principal PM' then 'Lead/Principal'
    when 'Director of Product' then 'Director+'
    when 'Head of Product' then 'Director+'
    when 'VP of Product' then 'VP/Head/CPO'
    when 'CPO' then 'VP/Head/CPO'
    else null
  end;
$$;

-- MATCHES mapHistoricalRole(): the numbered labels the old Google Form emitted.
-- '11-' is absent from the map in Code.gs and is absent here too.
create or replace function compass_historical_role_bucket(role text)
returns text language sql immutable as $$
  select case role
    when '01-Associate/Junior Product Manager' then 'APM'
    when '02-Mid Product Manager' then 'PM'
    when '03-Senior Product Manager' then 'Senior PM'
    when '04-Principal Product Manager' then 'Lead/Principal'
    when '05-Lead/Group Product Manager' then 'Lead/Principal'
    when '06-Head of Product' then 'Director+'
    when '07-Associate Director of Product Management' then 'Director+'
    when '08-Director of Product Management' then 'Director+'
    when '09-Senior Director of Product Management' then 'Director+'
    when '10-VP of Product Management' then 'VP/Head/CPO'
    when '12-Chief Product Officer' then 'VP/Head/CPO'
    else null
  end;
$$;

-- ── YoE bucketing ──
-- MATCHES numToBucket(). The boundaries overlap in the labels ('1-3' holds
-- 1 < y <= 3) but the function is total and deterministic, so we mirror it.
create or replace function compass_yoe_bucket(y numeric)
returns text language sql immutable as $$
  select case
    when y is null then null
    when y < 0 then null
    when y <= 1 then '0-1'
    when y <= 3 then '1-3'
    when y <= 5 then '3-5'
    when y <= 8 then '6-8'
    when y <= 12 then '9-12'
    else '13+'
  end;
$$;

-- MATCHES yoeToBucket() for the Historical tab, whose YoE column holds legacy
-- string buckets that Code.gs maps to a midpoint before bucketing.
create or replace function compass_yoe_parse(raw text)
returns numeric language plpgsql immutable as $$
declare s text; v numeric;
begin
  if raw is null then return null; end if;
  s := btrim(raw);
  if s = '' then return null; end if;

  case s
    when '0-2' then return 1;
    when '3-5' then return 4;
    when '6-8' then return 7;
    when '9-12' then return 10;
    when '13+' then return 14;
    else null;
  end case;

  -- MATCHES parseFloat(s.replace(',', '.')): a decimal comma is a decimal point,
  -- and trailing junk is ignored rather than rejected.
  begin
    v := (substring(replace(s, ',', '.') from '^-?[0-9]*\.?[0-9]+'))::numeric;
  exception when others then
    return null;
  end;
  return v;
end;
$$;

-- ════════════════════════════════════════════════════════════════════
--  compass_entries — the rows the benchmark aggregates
--
--  Union of the two sources computePercentiles() reads, with each source's
--  filters applied exactly as Code.gs applies them.
-- ════════════════════════════════════════════════════════════════════
create or replace view compass_entries as
  -- Historical: Portugal only, outliers excluded, base > 0 and a parseable YoE.
  select
    compass_historical_role_bucket(role_raw) as role_bucket,
    compass_yoe_bucket(compass_yoe_parse(yoe_raw)) as yoe_bucket,
    base_salary::numeric as base,
    -- MATCHES Code.gs: total falls back to base when absent or non-positive,
    -- so `total` is never null for a row that made it this far.
    (case when coalesce(total_comp, 0) > 0 then total_comp else base_salary end)::numeric as total
  from historical
  where btrim(coalesce(country, '')) = 'Portugal'
    and not outlier
    and coalesce(base_salary, 0) > 0
    and compass_yoe_bucket(compass_yoe_parse(yoe_raw)) is not null

  union all

  -- Submissions: "Not a PM" never counts, base > 0, YoE must bucket.
  select
    compass_role_bucket(role),
    compass_yoe_bucket(yoe),
    base_salary::numeric,
    (case when coalesce(total_comp, 0) > 0 then total_comp else base_salary end)::numeric
  from submissions
  where role <> 'Not a PM'
    and coalesce(base_salary, 0) > 0
    and compass_yoe_bucket(yoe) is not null;

-- ── District samples ──
-- MATCHES Code.gs, including two things worth stating out loud:
--   • the value aggregated is TOTAL comp (falling back to base), even though
--     the comment in Code.gs says "aggregate base salary by district";
--   • a row needs only a valid district and base > 0 — unlike the benchmark
--     entries above, it does NOT need a parseable YoE.
create or replace view compass_district_samples as
  select
    district,
    (case when coalesce(total_comp, 0) > 0 then total_comp else base_salary end)::numeric as value
  from submissions
  where role <> 'Not a PM'
    and coalesce(base_salary, 0) > 0
    and district is not null;

-- ════════════════════════════════════════════════════════════════════
--  compass_benchmark() — the public payload
--
--  Returns the identical JSON shape the Apps Script doGet() serves today,
--  so the frontend swaps one URL for another and nothing else changes.
-- ════════════════════════════════════════════════════════════════════
create or replace function compass_benchmark(
  min_bucket_n int default 5,     -- MIN_PUBLIC_BUCKET_N
  min_district_n int default 10   -- MIN_PUBLIC_DISTRICT_N
) returns jsonb language plpgsql stable
-- search_path is pinned because PG16+ runs CREATE/REFRESH MATERIALIZED VIEW with
-- a hardened path (pg_catalog, pg_temp) — without this the function cannot see
-- its own views when the cache refreshes. It is also what Supabase's
-- `function_search_path_mutable` lint asks for.
set search_path = public, pg_temp as $$
declare
  role_order text[] := array['APM','PM','Senior PM','Lead/Principal','Director+','VP/Head/CPO'];
  yoe_order  text[] := array['0-1','1-3','3-5','6-8','9-12','13+'];
  all_base numeric[];
  all_total numeric[];
  total_entries int;
  roles jsonb := '{}'::jsonb;
  yoes jsonb := '{}'::jsonb;
  tc_roles jsonb := '{}'::jsonb;
  tc_yoes jsonb := '{}'::jsonb;
  by_district jsonb := '{}'::jsonb;
  all_district numeric[];
  k text;
begin
  select array_agg(base), array_agg(total), count(*)
    into all_base, all_total, total_entries
  from compass_entries;

  -- Every role/YoE key is emitted even when empty, because the client indexes
  -- into them directly. An absent key would be a TypeError in the browser.
  foreach k in array role_order loop
    roles := roles || jsonb_build_object(k, compass_pcts(
      (select array_agg(base) from compass_entries where role_bucket = k), min_bucket_n));
    tc_roles := tc_roles || jsonb_build_object(k, compass_pcts(
      (select array_agg(total) from compass_entries where role_bucket = k), min_bucket_n));
  end loop;

  foreach k in array yoe_order loop
    yoes := yoes || jsonb_build_object(k, compass_pcts(
      (select array_agg(base) from compass_entries where yoe_bucket = k), min_bucket_n));
    tc_yoes := tc_yoes || jsonb_build_object(k, compass_pcts(
      (select array_agg(total) from compass_entries where yoe_bucket = k), min_bucket_n));
  end loop;

  select array_agg(value) into all_district from compass_district_samples;

  for k in select distinct district from compass_district_samples order by district loop
    by_district := by_district || jsonb_build_object(k, compass_pcts(
      (select array_agg(value) from compass_district_samples where district = k), min_district_n));
  end loop;

  return jsonb_build_object(
    'overall', compass_pcts(all_base, min_bucket_n),
    'roles', roles,
    'yoe', yoes,
    'totalComp', jsonb_build_object(
      'overall', compass_pcts(all_total, min_bucket_n),
      'roles', tc_roles,
      'yoe', tc_yoes
    ),
    'totalEntries', total_entries,
    'districts', jsonb_build_object(
      'portugal', compass_pcts(all_district, min_district_n),
      'byDistrict', by_district
    )
  );
end;
$$;

-- ── Cached payload ──
-- The Apps Script recomputed this from the whole Sheet on every cache miss
-- (measured 3.3s cold, 1.06s warm). Here it is computed on refresh only, and
-- read back as a single row.
create materialized view if not exists benchmark_cache as
  select compass_benchmark() as payload, now() as computed_at;

create unique index if not exists benchmark_cache_uniq on benchmark_cache ((true));

-- CONCURRENTLY needs the unique index above and lets readers keep serving the
-- previous payload while this runs.
create or replace function refresh_benchmark_cache() returns void
language plpgsql security definer set search_path = public as $$
begin
  refresh materialized view concurrently benchmark_cache;
end;
$$;

-- ── Counts (Apps Script ?action=count) ──
create or replace function compass_counts() returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'submissions', (select count(*) from submissions),
    'emails',      (select count(*) from contacts),
    'surveys',     (select count(*) from submissions where full_survey),
    'historical',  (select count(*) from historical),
    'total',       (select count(*) from submissions) + (select count(*) from historical)
  );
$$;

-- ══════════ 003_api.sql ══════════

-- ════════════════════════════════════════════════════════════════════
--  Salary Compass — RPCs the API calls
--
--  Anything that is not a plain insert or select lives here rather than in
--  the Worker, so the invariant is enforced by the database and cannot be
--  skipped by a second caller later.
-- ════════════════════════════════════════════════════════════════════

create or replace function jsonb_key_count(j jsonb)
returns int language sql immutable as $$
  select count(*)::int from jsonb_object_keys(coalesce(j, '{}'::jsonb));
$$;

-- ── Merge survey answers ──
-- A PostgREST PATCH would REPLACE the jsonb column, so a survey resumed from
-- the reminder email's deep link would wipe whatever the first pass stored.
-- `||` merges instead, which is the behaviour the funnel actually needs: the
-- row is created at the comparison step and enriched, possibly more than once.
create or replace function compass_update_survey(p_id uuid, p_survey jsonb)
returns jsonb language plpgsql
set search_path = public, pg_temp as $$
declare updated submissions;
begin
  update submissions
     set survey = survey || p_survey,
         full_survey = true,
         survey_at = coalesce(survey_at, now())  -- first completion wins
   where id = p_id
  returning * into updated;

  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'id', updated.id,
    'fields', jsonb_key_count(updated.survey)
  );
end;
$$;

-- ── Record a contact ──
-- The Sheet appends blindly, so the same person filling the gate twice is two
-- rows and the "emails" counter overstates the list. The unique index on
-- (email, source) makes that impossible; this upsert makes a repeat capture
-- idempotent instead of an error, and keeps the FIRST token so a link already
-- sent by email never stops working.
create or replace function compass_record_contact(
  p_email text,
  p_source text,
  p_submission_id uuid default null,
  p_report_optin boolean default false,
  p_newsletter_optin boolean default false,
  p_percentile int default null
) returns jsonb language sql
set search_path = public, pg_temp as $$
  with upsert as (
    insert into contacts (email, source, submission_id, report_optin, newsletter_optin, percentile)
    values (lower(btrim(p_email)), p_source, p_submission_id, p_report_optin, p_newsletter_optin, p_percentile)
    on conflict (email, source) do update
      set submission_id    = coalesce(excluded.submission_id, contacts.submission_id),
          -- Opt-ins only ever go from false to true here. Withdrawing consent is
          -- a different operation with its own audit trail, never a silent side
          -- effect of somebody re-submitting a form.
          report_optin     = contacts.report_optin or excluded.report_optin,
          newsletter_optin = contacts.newsletter_optin or excluded.newsletter_optin,
          percentile       = coalesce(excluded.percentile, contacts.percentile)
    -- xmax is 0 on a genuine insert and non-zero on the conflict path. It is the
    -- standard way to tell an upsert's two outcomes apart, and the caller needs
    -- to know: a first capture sends a welcome email, a repeat must not.
    returning id, token, (xmax = 0) as was_insert
  )
  select jsonb_build_object(
    'status', 'ok',
    'id', id,
    'token', token,
    'created', was_insert
  ) from upsert;
$$;

-- ── Email bookkeeping ──
create or replace function compass_log_email(
  p_contact_id uuid, p_kind text, p_ok boolean,
  p_resend_id text default null, p_error text default null
) returns void language plpgsql
set search_path = public, pg_temp as $$
begin
  insert into email_log (contact_id, kind, ok, resend_id, error)
  values (p_contact_id, p_kind, p_ok, p_resend_id, p_error);

  -- Mirrors the "Result Email Sent" / "Reminder N Sent" columns the cron
  -- scripts maintain by hand in the Sheet today.
  if p_ok then
    update contacts set
      result_email_at = case when p_kind = 'result'     then now() else result_email_at end,
      reminder_1_at   = case when p_kind = 'reminder_1' then now() else reminder_1_at end,
      reminder_2_at   = case when p_kind = 'reminder_2' then now() else reminder_2_at end
    where id = p_contact_id;
  end if;
end;
$$;

-- ── Who still needs a nudge ──
-- survey-reminders.gs reads both sheets into memory and loops over them. Here
-- the same question is a query, which is also what makes it testable.
create or replace function compass_pending_reminders(
  p_stage int,                       -- 1 or 2
  p_after interval,                  -- 24h / 72h
  p_limit int default 80
) returns table (contact_id uuid, email text, token uuid, submission_id uuid)
language sql stable set search_path = public, pg_temp as $$
  select c.id, c.email, c.token, c.submission_id
  from contacts c
  left join submissions s on s.id = c.submission_id
  where c.source = 'email_gate'
    and (c.report_optin or c.newsletter_optin)
    and coalesce(s.full_survey, false) = false
    and c.created_at < now() - p_after
    and case p_stage
          when 1 then c.reminder_1_at is null
          when 2 then c.reminder_2_at is null and c.reminder_1_at is not null
          else false
        end
  order by c.created_at
  limit p_limit;
$$;

-- ── Who is due the deferred result email ──
-- Ports result-emails.gs. Two details from the original are load-bearing:
--
--  • The delay. The email goes out ~7 minutes after capture, not immediately,
--    so it can tell whether the person completed the survey in the same session
--    and drop the survey CTA if they did. Asking someone to do what they just
--    did is the fastest way to look automated.
--  • The lookback. Captures older than RESULT_LOOKBACK_MS are skipped, so
--    turning the job on after an outage does not mail three days of backlog.
--
-- full_survey and percentile come back with the row because the template needs
-- both, and fetching them here avoids a second round trip per contact.
create or replace function compass_pending_results(
  p_after interval default '7 minutes',
  p_lookback interval default '3 days',
  p_limit int default 80
) returns table (
  contact_id uuid, email text, token uuid, submission_id uuid,
  percentile int, full_survey boolean
)
language sql stable set search_path = public, pg_temp as $$
  select c.id, c.email, c.token, c.submission_id, c.percentile,
         coalesce(s.full_survey, false)
  from contacts c
  left join submissions s on s.id = c.submission_id
  where c.source = 'email_gate'
    and c.result_email_at is null
    and c.created_at < now() - p_after
    and c.created_at > now() - p_lookback
  order by c.created_at
  limit p_limit;
$$;

-- ══════════ 004_rls.sql ══════════

-- ════════════════════════════════════════════════════════════════════
--  Salary Compass — row level security
--
--  The posture is: the browser never talks to Supabase. It talks to the
--  Pages Function, which holds the service role key and is the only writer.
--  So every table denies everything to anon and authenticated, and there is
--  no policy to grant it back.
--
--  This matters more than it looks. The reason the current backend can be
--  poisoned is that its write path is a public, anonymous, unauthenticated
--  URL. Moving to Supabase with a permissive anon policy would reproduce
--  that hole with extra steps — the anon key ships in the page.
--
--  RLS is enabled with NO permissive policies, which denies by default. The
--  service role bypasses RLS by design, which is what keeps the API working.
-- ════════════════════════════════════════════════════════════════════

-- Supabase ships the `anon` and `authenticated` roles; a bare Postgres (and the
-- PGlite test harness) does not. Created here only when missing, so the same
-- file applies cleanly to both and the grants below never depend on which one
-- it is running against.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
end
$$;

alter table submissions enable row level security;
alter table contacts    enable row level security;
alter table email_log   enable row level security;
alter table historical  enable row level security;

-- FORCE also subjects the table owner to RLS, so a stray session connected as
-- the owner cannot read salary rows either. The service role still bypasses it.
alter table submissions force row level security;
alter table contacts    force row level security;
alter table email_log   force row level security;

-- No policies are created on purpose. Any `create policy ... to anon` added
-- later re-opens the write path that this migration exists to close; if one is
-- ever needed, it should be reviewed on exactly those terms.

-- ── The one public read ──
-- The benchmark is aggregate, already suppressed below n=5 (n=10 for
-- districts) by compass_pcts, and is what the page shows to everyone. It is
-- served through the Worker like everything else, but it is also the only
-- object where a direct anon read would be harmless, so it is granted
-- explicitly rather than by accident.
grant select on benchmark_cache to anon;

-- Nothing else is readable by anon, including the views the cache is built
-- from: compass_entries is one row per person's salary.
revoke all on compass_entries from anon;
revoke all on compass_district_samples from anon;

-- ── Scheduled refresh ──
-- The Apps Script cached for 300s and recomputed on demand, so whoever arrived
-- after a write paid 3.3s. Refreshing on a schedule moves that cost off the
-- request path entirely. Requires pg_cron (available on Supabase).
--
--   select cron.schedule('refresh-benchmark', '*/5 * * * *',
--                        $$select refresh_benchmark_cache()$$);
--
-- Left commented because enabling an extension is a decision for the person
-- running the migration, not a side effect of applying the schema.
