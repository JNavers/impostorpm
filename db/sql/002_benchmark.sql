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
-- Dropped and recreated rather than IF NOT EXISTS: a materialized view has no
-- CREATE OR REPLACE, and this file is meant to be re-appliable. It is a cache,
-- so losing it costs one refresh.
drop materialized view if exists benchmark_cache;
create materialized view benchmark_cache as
  select 1::int as id, compass_benchmark() as payload, now() as computed_at;

-- On a real COLUMN, not on ((true)). REFRESH ... CONCURRENTLY requires a unique
-- index over one or more columns with no WHERE clause; an index over a constant
-- expression is accepted at CREATE time and then rejected at refresh time with
-- "cannot refresh materialized view concurrently". Found against the live
-- project, because the tests refreshed non-concurrently and never exercised it.
create unique index benchmark_cache_uniq on benchmark_cache (id);

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
