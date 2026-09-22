-- ════════════════════════════════════════════════════════════════════
--  Salary Compass — the Sheet's id, kept alongside ours
--
--  During dual-write the page still keys everything off the id it generates
--  for the Sheet (column A of Submissions). The result and reminder emails
--  carry that id in their survey link (`?sid=`), and a survey opened from one
--  of those links — or on a later visit — has no way to know the uuid this
--  database assigned: the mapping only ever lived in the page's memory. So
--  every survey completed that way reached the Sheet and silently missed here.
--
--  Storing the Sheet id makes the row findable by the only id the link has.
--  Additive and nullable: code that does not know the column ignores it.
-- ════════════════════════════════════════════════════════════════════

alter table submissions add column if not exists legacy_id text;

-- NOT unique, on purpose. The page reuses its id when someone compares again
-- without reloading, so the Sheet already holds 50 ids shared by 137 rows
-- (2026-09-22 export). That shared id is the only sign those rows are one
-- person, which step 4 needs to decide how they count. A unique index would
-- force every repeat to drop it.
create index if not exists submissions_legacy_id_idx
  on submissions (legacy_id) where legacy_id is not null;

comment on column submissions.legacy_id is
  'The id the page generated for the Sheet (Submissions column A). Lets a survey opened from an email link find its row. Null for rows with no Sheet counterpart.';

-- ── Merge survey answers, found by the Sheet id ──
-- Same merge as compass_update_survey; only the lookup differs. When several
-- rows share the id, the OLDEST gets the survey, because that is the row
-- updateSubmission_ in Code.gs writes to (it stops at the first match).
-- Keeping the two stores on the same row is what makes step 4's diff clean.
create or replace function compass_update_survey_legacy(p_legacy_id text, p_survey jsonb)
returns jsonb language plpgsql
set search_path = public, pg_temp as $$
declare updated submissions;
begin
  update submissions
     set survey = survey || p_survey,
         full_survey = true,
         survey_at = coalesce(survey_at, now())
   where id = (select s.id from submissions s
                where s.legacy_id = p_legacy_id
                order by s.created_at, s.id
                limit 1)
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
