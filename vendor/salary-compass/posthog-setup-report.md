<wizard-report>
# PostHog post-wizard report

The wizard completed a PostHog analytics integration for the Salary Compass project. After the wizard run, the implementation was scoped so the manual event work is focused on the interactive `salary-compass/index.html` tool. The `compensation/index.html` landing page only keeps the shared PostHog loader because that page is expected to change substantially.

**What was done:**

- **PostHog token activated** — both pages previously had an empty `TIPM_POSTHOG_CONFIG.token`. The live EU project token is now set in both files, with the canonical value stored in `.env` as `POSTHOG_PROJECT_TOKEN`.
- **Salary Compass events prioritized** — the interactive salary tool has the complete funnel, performance, bottleneck, sharing, and survey instrumentation. The only wizard-added manual event kept is `comp_dashboard_card_view`.
- **Dashboard & insights created** — five insights covering the full user journey were added to a new "Analytics basics" dashboard.

## Events instrumented

| Event | Description | File |
|---|---|---|
| `comp_dashboard_card_view` | Dashboard email-capture card becomes visible after user gets salary results. Top of the dashboard-signup conversion funnel. | `salary-compass/index.html` |

> Note: `comp_dashboard_email_submit` was planned but found to already be captured by the existing `comp_survey_email_submit` event (same form submission). No duplicate was added.

## Pre-existing events (unchanged)

The following events were already instrumented and were not modified:

**Salary Compass tool** (`salary-compass/index.html`): `comp_landing_view`, `comp_counter_view`, `comp_live_data_load`, `comp_form_start`, `comp_step_complete` (steps 1–5), `comp_form_submit_blocked`, `comp_compare_submit`, `comp_results_view`, `comp_survey_cta_view`, `comp_share_card_view`, `comp_survey_email_submit`, `comp_upsell_click`, `comp_survey_intro_view`, `comp_survey_dropoff`, `comp_survey_chapter_start`, `comp_survey_chapter_blocked`, `comp_survey_chapter_complete`, `comp_survey_submit_blocked`, `comp_survey_complete`, `comp_share_post_survey_view`, `comp_share_click`, `comp_share_post_survey_click`, `comp_survey_field_filled`, `comp_sheets_submit_timing`, `tipm_page_performance`, `tipm_web_vitals`, `tipm_posthog_loaded`.

**Compensation landing** (`compensation/index.html`): no page-specific manual events are kept in the repo now. The shared PostHog loader still provides pageview, autocapture, performance, and error capture until the page is redesigned.

## Next steps

We've built a dashboard and five insights to monitor user behavior based on the instrumented events:

- [Analytics basics dashboard](https://eu.posthog.com/project/182963/dashboard/692145)
- [Salary Compass – Core Conversion Funnel](https://eu.posthog.com/project/182963/insights/7Q8vQo8o) — form start → compare submit → results → dashboard card → email submit
- [Survey Completion Funnel](https://eu.posthog.com/project/182963/insights/rI3AJ5Ho) — survey intro → chapter start → chapter complete → survey complete
- [Share Clicks by Channel](https://eu.posthog.com/project/182963/insights/xSpFyRUx) — LinkedIn / WhatsApp / Twitter / copy / PNG breakdown
- [Key Events Daily Volume](https://eu.posthog.com/project/182963/insights/rkl3RsNR) — daily trend of all 5 core events
- [Compensation Landing – CTA Conversion Funnel](https://eu.posthog.com/project/182963/insights/Tn2j8vkj) — created by the wizard, but should be considered temporary because page-specific landing events were deprioritized in the repo.

</wizard-report>
