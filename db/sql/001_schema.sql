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
