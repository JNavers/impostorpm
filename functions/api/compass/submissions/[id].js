/**
 * PATCH /api/compass/submissions/:id
 *
 * Replaces action=update: the long survey enriching the row the comparison
 * created.
 *
 * Code.gs did this by scanning column A for the id and then issuing ~40
 * individual setValue() calls — one round trip per answer, under a global
 * 5-second lock. Here it is one UPDATE on a primary key, and the ~35 answers
 * that nothing aggregates go into `survey` jsonb rather than into 35 columns
 * that would need a migration every time the survey changes.
 */

import {
  json, preflight, readJson, supabase, cleanUuid, cleanText, cleanMoney,
  cleanNumber, BadRequest
} from '../_lib.js';

export const onRequestOptions = preflight;

/**
 * The survey fields, with the cleaner each one gets. Lifted from the
 * updateSubmission_ column assignments so the same limits apply: the same
 * lengths, the same ranges, the same formula-injection guard.
 */
const SURVEY_FIELDS = {
  gender: (v) => cleanText(v, 40),
  company: (v) => cleanText(v, 120),
  industry: (v) => cleanText(v, 80),
  orgSize: (v) => cleanText(v, 40),
  companyType: (v) => cleanText(v, 80),
  remotePolicy: (v) => cleanText(v, 80),
  companyLocation: (v) => cleanText(v, 80),
  employment: (v) => cleanText(v, 80),
  perks: (v) => cleanText(v, 500),
  transparency: (v) => cleanNumber(v, 1, 5, 'transparency'),
  salaryAdequacy: (v) => cleanNumber(v, 1, 5, 'salaryAdequacy'),
  negotiationComfort: (v) => cleanNumber(v, 1, 5, 'negotiationComfort'),
  bonus: (v) => cleanMoney(v, 0, 1000000, 'bonus'),
  equityGrant: (v) => cleanMoney(v, 0, 1000000, 'equityGrant'),
  fullSurveyTotalComp: (v) => cleanMoney(v, 0, 1500000, 'fullSurveyTotalComp'),
  currency: (v) => cleanText(v, 10),
  hasEquity: (v) => cleanText(v, 20),
  perksValue: (v) => cleanMoney(v, 0, 1000000, 'perksValue'),
  seniority: (v) => cleanText(v, 80),
  yearsCurrentRole: (v) => cleanNumber(v, 0, 50, 'yearsCurrentRole'),
  topSkills: (v) => cleanText(v, 300),
  companyTypeOther: (v) => cleanText(v, 100),
  industryOther: (v) => cleanText(v, 100),
  hybridDays: (v) => cleanNumber(v, 0, 31, 'hybridDays'),
  hybridDaysFrequency: (v) => cleanText(v, 20),
  companyLocationOther: (v) => cleanText(v, 100),
  officeInCountry: (v) => cleanText(v, 10),
  employmentOther: (v) => cleanText(v, 100),
  perkWellness: (v) => cleanMoney(v, 0, 100000, 'perkWellness'),
  perkHomeOffice: (v) => cleanMoney(v, 0, 100000, 'perkHomeOffice'),
  perkLearning: (v) => cleanMoney(v, 0, 100000, 'perkLearning'),
  perkMeal: (v) => cleanMoney(v, 0, 1000, 'perkMeal'),
  perkPension: (v) => cleanMoney(v, 0, 200000, 'perkPension')
};

export async function onRequestPatch({ request, env, params }) {
  try {
    const id = cleanUuid(params.id);
    const data = await readJson(request);

    const survey = {};
    for (const [field, clean] of Object.entries(SURVEY_FIELDS)) {
      if (data[field] === undefined || data[field] === null || data[field] === '') continue;
      const value = clean(data[field]);
      if (value !== null && value !== '') survey[field] = value;
    }

    if (!Object.keys(survey).length) throw new BadRequest('No survey answers supplied');

    // Goes through the RPC rather than a PATCH on purpose: a PostgREST PATCH
    // REPLACES the jsonb column, so a survey resumed from the reminder email's
    // deep link would wipe what the first pass stored. compass_update_survey
    // merges with `||` instead.
    const result = await supabase(env).rpc('compass_update_survey', {
      p_id: id,
      p_survey: survey
    });

    if (result?.status === 'not_found') {
      return json({ status: 'error', message: 'Unknown submission' }, 404);
    }

    return json({ status: 'ok', id, fields: result?.fields ?? Object.keys(survey).length });
  } catch (err) {
    if (err instanceof BadRequest) return json({ status: 'error', message: err.message }, 400);
    console.error('update submission failed:', err.message);
    return json({ status: 'error', message: 'Could not save the survey' }, 500);
  }
}
