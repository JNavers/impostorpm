# salary-compass

Salary Compass product for The Impostor PM

## Project structure

- `compensation/`: public landing page for the Salary Compass product.
- `salary-compass/`: interactive Salary Compass tool.
- `compensation/apps-script/`: Google Apps Script backend used by the product.

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
