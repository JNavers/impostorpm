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
