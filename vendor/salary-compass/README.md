# Salary Compass

A PM compensation benchmarking tool for the Portugal market, built by The Impostor PM. PMs enter their salary and get an instant percentile ranking against the community — no account required. The data it benchmarks against is crowdsourced from the community itself.

## How it works

### Two-phase funnel

**Phase 1 — Quick comparison**

The user fills in five steps: base salary, role (9 levels from APM to CPO), years of experience, city/district, and a perception slider where they guess what percentile they think they are at. On submit, their data is written to a Google Sheet and they immediately see their results.

**Phase 2 — Full survey (optional)**

After seeing results, users can optionally complete a deeper survey covering company details, perks, equity, and attitudes toward compensation transparency. This enriches the dataset for others.

### Percentile calculation

The backend (a Google Apps Script) reads all submissions from Google Sheets, groups them by role, years-of-experience bucket, and district, then computes p10/p25/p50/p75/p90 for each segment. The frontend uses linear interpolation across those reference points to place the user's salary on a 1–99 scale.

Minimum sample-size thresholds apply: at least 50 total entries to use overall data, 5 per bucket for segmented data, and 10 per district for regional benchmarks. Below those thresholds the tool falls back to hardcoded historical data baked into the HTML, so results always show up even when live data is thin.

### What users see

- A percentile gauge showing their position relative to the community
- Their perception guess vs. their actual percentile
- Horizontal bar charts broken down by role and by experience bracket
- Regional medians by Portuguese district (where data is sufficient)
- An optional email capture that generates a dashboard token for later access

## Architecture

- **Frontend**: Plain HTML/JS with Bootstrap 4, hosted as a static site. Includes embedded fallback salary data for offline/low-volume scenarios.
- **Backend**: Google Apps Script deployed as a public HTTP endpoint. Computes and caches percentiles for 5 minutes.
- **Storage**: Google Sheets with three tabs — Submissions, Emails, and Historical.
- **Analytics**: PostHog, tracking every funnel step and A/B test variants.
- **Data integrity**: Server-side enum whitelists, formula injection prevention, and outlier flagging on the Historical tab.

## Project structure

- `salary-compass/index.html` — Main interactive tool
- `compensation/index.html` — Public landing page
- `compensation/apps-script/Code.gs` — Google Apps Script backend (HTTP endpoints, percentile computation, Sheets I/O)

## Local development and testing

Append `?test=1` to the URL to enable test mode. This blocks all backend writes, silences analytics, and shows a floating panel with preset form values — safe for local development without polluting the dataset.

## Data quality notes

The tool is Portugal-only, which keeps the dataset focused but means sample size is the key variable to watch. Per-bucket thresholds are the main guardrail: if community submissions are sparse, more segments fall back to the embedded historical snapshot rather than live data. Growing the contributor base directly improves benchmark precision.

## Deployment

This repository is deployed independently from the main The Impostor PM website.
Frontend pages are intended to be hosted through Cloudflare, while backend logic
lives in Google Apps Script.

## Configuration

Do not commit secrets, private tokens, API keys, or production-only credentials to
this repository. Keep sensitive configuration in the relevant hosting platform,
Google Apps Script project settings, or other external secret stores.

### PostHog

PostHog is initialized through `assets/posthog-init.js` on both public pages. The
client is configured for PostHog Cloud EU:

- API host: `https://eu.i.posthog.com`
- UI host: `https://eu.posthog.com`

The public PostHog project token is set in the page config and mirrored locally in
the ignored `.env` file as `POSTHOG_PROJECT_TOKEN`. If the project token ever
changes, update `window.TIPM_POSTHOG_CONFIG.token` before `assets/posthog-init.js`
loads:

```html
<script>
    window.TIPM_POSTHOG_CONFIG = {
        token: 'phc_your_public_project_token',
        apiHost: 'https://eu.i.posthog.com',
        uiHost: 'https://eu.posthog.com'
    };
</script>
```

The primary manual instrumentation is in `salary-compass/index.html`. It captures
page usage, client errors, Web Vitals, slow resources, Google Sheets submit
timings, comparison funnel events, email opt-in identification using a SHA-256
email hash, dashboard-card exposure, sharing, survey progression, and experiment
exposure events.

`compensation/index.html` only keeps the shared PostHog loader for baseline
pageview/autocapture/performance/error collection because that landing page is
expected to change.

Feature flags prepared for A/B tests:

- `salary_compass_survey_cta`
- `salary_compass_share_strip`

Use `?__posthog_debug=true` in the URL to enable PostHog browser debug logging.
