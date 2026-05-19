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
