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
