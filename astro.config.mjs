// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://www.impostor.pm',

  // Generated rather than hand-written: the Softr sitemap listed 39 URLs of which
  // ~12 were junk (/test-page12345, /home-copy, /club/*-v1-deprecated) that are
  // now 301s, and a hand-maintained file drifts from the routes on the next page
  // added. /sitemap-index.xml is what gets submitted.
  //
  // Excludes must stay in sync with the pages that render <meta robots="noindex">
  // — listing a noindex URL in the sitemap is a contradictory signal to Google.
  integrations: [
    sitemap({
      filter: (page) =>
        !page.includes('/product-talks-link-to-the-talk') && !page.includes('/404'),

      // Both live in public/ as self-contained apps, so they are not Astro routes
      // and the integration cannot see them — but they are real indexable pages,
      // and /salary-compass/ is the most valuable page on the site. Trailing
      // slashes are required: they are directory indexes, and the slashless form
      // 308s.
      customPages: [
        'https://www.impostor.pm/salary-compass/',
        'https://www.impostor.pm/rezonant/',
      ],
    }),
  ],

  // Softr serves and Google has indexed every URL WITHOUT a trailing slash
  // (/club/hamburg, /compensation, ...). `format: 'file'` emits huddle.html
  // rather than huddle/index.html, so Cloudflare Pages serves /huddle
  // directly instead of 308-ing it to /huddle/. Changing either of these
  // silently 308s every indexed URL on cutover day.
  trailingSlash: 'never',
  build: { format: 'file' },
});
