# Analytics Events — Product Salary Compass

PostHog events fired by `salary-compass/index.html`, organised by journey stage.
All events go through the local `track(event, props)` helper, which forwards to
`window.tipmAnalytics.track()`. Tracking is disabled on localhost.

> Last reviewed: 2026-06-08

---

## 1 · Landing / load

| Event | Fires when | Key props |
|---|---|---|
| `comp_landing_view` | The `/compensation/` page loads | — |
| `comp_live_data_load` | The live sample from the Sheet arrives (or fails) | load status / count |

## 2 · Compare form

| Event | Fires when | Key props |
|---|---|---|
| `comp_form_start` | First field of the compare form is touched | — |
| `comp_step_complete` | A form step is completed | `step` |
| `comp_form_submit_blocked` | Submit blocked by validation | `errors_count` |
| `comp_compare_submit` | Valid submit (percentile computed) | `role`, `role_key`, `yoe_bucket`, `city`, `salary_band`, `effective_comp_band`, `total_comp_included`, `perception_guess`, `overall_percentile`, `role_percentile`, `perception_delta` |
| `comp_not_a_pm_select` | User picks "I'm not a Product Manager" | — |
| `comp_not_a_pm_submit` | The non-PM mini-form is submitted | — |

## 3 · Email gate (results locked)

| Event | Fires when | Key props |
|---|---|---|
| `comp_email_gate_view` | The gate opens (results blurred behind it) | `percentile` |
| `comp_email_gate_submit` | Valid email submitted → unlocks results | `optin`, `percentile` |

## 4 · Results reveal

These fire only when results are **actually visible** — either the gate was
bypassed (returning session) or it was just unlocked. They are deliberately kept
out of `displayResults()` so blurred/gated renders don't inflate view counts.

| Event | Fires when | Key props |
|---|---|---|
| `comp_results_view` | Results truly visible to the user | `percentile` |
| `comp_dashboard_card_view` | Dashboard card visible | `percentile` |
| `comp_survey_cta_view` | Survey CTA visible | `variant` |
| `comp_share_card_view` | Share strip visible (below-survey-hero) | `variant`, `placement` |

## 5 · Full survey (modal)

| Event | Fires when | Key props |
|---|---|---|
| `comp_survey_deeplink_open` | Survey opened via deep-link | `has_sid` |
| `comp_survey_intro_view` | Survey intro is shown | `contributor_number` |
| `comp_survey_field_filled` | A survey field is filled | field id |
| `comp_survey_chapter_start` | A chapter begins | chapter |
| `comp_survey_chapter_complete` | A chapter is completed | chapter |
| `comp_survey_chapter_blocked` | Advance blocked by validation | chapter |
| `comp_survey_submit_blocked` | Final submit blocked | `missing_count` |
| `comp_survey_dropoff` | Modal closed before finishing | `last_chapter`, `fields_filled_count`, `last_field_id`, `time_ms` |
| `comp_survey_complete` | Survey submitted successfully | `fields_filled_count`, `survey_completion_pct`, `time_ms`, `contributor_number` |

## 6 · Share

| Event | Fires when | Key props |
|---|---|---|
| `comp_share_click` | Click on share (results strip) | `channel`, `variant`, `surface` |
| `comp_share_post_survey_view` | Post-survey success panel visible (includes the contributor counter) | `percentile`, `contributor_number` |
| `comp_share_post_survey_click` | Click on share from the success panel | `channel`, `contributor_number` |

## 7 · Newsletter / upsell

| Event | Fires when | Key props |
|---|---|---|
| `comp_newsletter_popup_view` | Newsletter popup visible | `percentile` |
| `comp_newsletter_popup_submit` | Email submitted in the popup | `percentile` |
| `comp_newsletter_popup_dismiss` | Popup closed without submitting | — |
| `comp_footer_newsletter_submit` | Footer newsletter submitted | — |
| `comp_upsell_click` | Click on the upsell | upsell context |

---

## Notes

- The pre-survey contributor counter no longer has its own event
  (`comp_counter_view` was removed). Its visibility is now measured via
  `comp_share_post_survey_view`, which only happens after a user contributes —
  the counter is shown as a reward, not a pre-decision barrier.
- `identifyEmail()` is called (not via `track`) at the email gate and survey
  submit to associate the PostHog person with their email and opt-in flags.
- `submission_id` is registered as a PostHog super-property (and person property)
  via `registerSubmissionId()` only once a real Submissions row exists — on
  compare submit, on the "not a PM" submit, and on a deep-link `sid` rebind. It
  carries on every subsequent event so PostHog data can be joined back to its
  Sheets row. The PostHog `distinct_id` is left untouched.
