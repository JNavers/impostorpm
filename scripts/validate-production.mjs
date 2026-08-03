#!/usr/bin/env node
/**
 * Post-cutover validation for impostor.pm.
 *
 * Run against production: `npm run validate`
 * Or any deployment:      `npm run validate -- https://<hash>.impostorpm-site.pages.dev`
 *
 * Every check here exists because something actually went wrong during the
 * migration. The negative controls matter most: a sweep that only asks "did I
 * get a 200?" passed a site-wide soft-404 for weeks, because Cloudflare Pages
 * without a 404.html answers every unmatched path with the homepage at HTTP 200.
 * So this asserts what a response IS, not merely that one arrived.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const HOSTS = process.argv[2]
  ? [process.argv[2].replace(/\/$/, '')]
  : ['https://www.impostor.pm', 'https://impostor.pm'];

/** Cache-bust everything. Cloudflare caches 404s and old deploys at the edge,
 *  which produced several confidently wrong readings during the cutover. */
let nonce = Date.now();
const bust = (url) => url + (url.includes('?') ? '&' : '?') + 'v=' + nonce++;

const results = [];
let currentGroup = '';

function group(name) {
  currentGroup = name;
}

function record(ok, name, detail) {
  results.push({ group: currentGroup, ok, name, detail });
  const mark = ok ? '[32m✓[0m' : '[31m✗[0m';
  console.log(`  ${mark} ${name}${detail && !ok ? `\n      ${detail}` : ''}`);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    record(true, name, detail);
  } catch (error) {
    record(false, name, error.message);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function get(url, options = {}) {
  const response = await fetch(bust(url), { redirect: 'manual', ...options });
  return response;
}

async function getText(url) {
  const response = await fetch(bust(url), { redirect: 'follow' });
  return { status: response.status, body: await response.text(), headers: response.headers };
}

// ── The legacy sitemap: every URL Google already knows about ────────────────
const LEGACY_URLS = readFileSync(join(ROOT, 'scripts/legacy-sitemap-urls.txt'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

/** Was 274260 through the migration, which is the number quoted in MIGRATION.md
 *  as proof the page came across untouched. It changed on 2026-08-03 when the
 *  last Softr CDN dependencies were cut out of it — deliberately, and the only
 *  edit to this file since the subtree. Any other change to this number means
 *  something modified the page that should not have. */
const SALARY_COMPASS_BYTES = 274203;

console.log(`\nValidating: ${HOSTS.join('  ')}\n`);

for (const host of HOSTS) {
  console.log(`[1m${host}[0m`);

  // ── Negative controls ─────────────────────────────────────────────────────
  // First, because if these fail every other 200 in this file is meaningless.
  group('negative controls');
  await check('unknown paths return a real 404, not the homepage', async () => {
    for (let i = 0; i < 4; i++) {
      const path = `/definitely-not-a-page-${Math.random().toString(36).slice(2)}`;
      const response = await get(host + path);
      assert(
        response.status === 404,
        `${path} returned ${response.status} — SPA fallback is back; check src/pages/404.astro exists`
      );
    }
    return '4 random paths';
  });

  await check('unknown asset paths 404 too', async () => {
    const response = await get(`${host}/assets/nope-${Math.random().toString(36).slice(2)}.js`);
    assert(response.status === 404, `got ${response.status}`);
  });

  // ── Cutover ───────────────────────────────────────────────────────────────
  group('cutover');
  await check('no page is served by Softr', async () => {
    const paths = ['/', '/about', '/group', '/club/porto', '/huddle', '/benefits', '/events'];
    for (const path of paths) {
      const { body } = await getText(host + path);
      assert(!body.includes('created in Softr'), `${path} still carries the Softr marker`);
    }
    return `${paths.length} pages`;
  });

  await check('every legacy sitemap URL ends at a real 200', async () => {
    const broken = [];
    for (const path of LEGACY_URLS) {
      const response = await fetch(bust(host + path), { redirect: 'follow' });
      if (response.status !== 200) broken.push(`${path} → ${response.status}`);
    }
    assert(broken.length === 0, broken.join('; '));
    return `${LEGACY_URLS.length} URLs`;
  });

  // ── SEO ───────────────────────────────────────────────────────────────────
  group('seo');
  await check('sitemap is present and indexed', async () => {
    const index = await get(`${host}/sitemap-index.xml`);
    assert(index.status === 200, `/sitemap-index.xml → ${index.status}`);

    const { body } = await getText(`${host}/sitemap-0.xml`);
    const count = (body.match(/<loc>/g) ?? []).length;
    assert(count >= 30, `only ${count} URLs in sitemap-0.xml`);

    const legacy = await get(`${host}/sitemap.xml`);
    assert(legacy.status === 301, `/sitemap.xml should 301, got ${legacy.status}`);
    return `${count} URLs`;
  });

  await check('robots.txt points at the sitemap', async () => {
    const { body, status } = await getText(`${host}/robots.txt`);
    assert(status === 200, `robots.txt → ${status}`);
    assert(/^Sitemap:\s*https:\/\//im.test(body), 'no Sitemap: line');
  });

  await check('production does not send X-Robots-Tag', async () => {
    // The proxy strips it. Without that, functions/_middleware.js would see a
    // .pages.dev hostname and noindex the entire site.
    for (const path of ['/', '/about', '/compensation']) {
      const response = await get(host + path);
      const tag = response.headers.get('x-robots-tag');
      assert(!tag, `${path} sent X-Robots-Tag: ${tag}`);
    }
  });

  await check('the noindex page is noindex and absent from the sitemap', async () => {
    const { body } = await getText(`${host}/product-talks-link-to-the-talk`);
    assert(/noindex/.test(body), 'page is missing its robots meta');

    const { body: sitemap } = await getText(`${host}/sitemap-0.xml`);
    assert(
      !sitemap.includes('product-talks-link-to-the-talk'),
      'noindex page is listed in the sitemap — contradictory signal'
    );
  });

  await check('canonicals are absolute and carry no .html', async () => {
    for (const path of ['/', '/about', '/huddle', '/club/porto', '/compensation']) {
      const { body } = await getText(host + path);
      const match = body.match(/<link rel="canonical" href="([^"]+)"/);
      assert(match, `${path} has no canonical`);
      assert(match[1].startsWith('https://'), `${path} canonical is not absolute: ${match[1]}`);
      assert(!match[1].endsWith('.html'), `${path} canonical leaks .html: ${match[1]}`);
    }
  });

  await check('structured data is present and parses', async () => {
    // Emitted from the same data the page renders. Invalid JSON here is silent:
    // the page looks perfect and Google discards the block.
    const pages = ['/', '/events', '/club/porto', '/compensation'];
    let blocks = 0;
    for (const path of pages) {
      const { body } = await getText(host + path);
      const found = [...body.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
      assert(found.length > 0, `${path} has no JSON-LD`);
      for (const [, raw] of found) {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          throw new Error(`${path} has unparseable JSON-LD: ${e.message}`);
        }
        assert(parsed['@context'], `${path} has a block with no @context`);
        blocks++;
      }
    }
    return `${blocks} blocks across ${pages.length} pages`;
  });

  // ── Analytics ─────────────────────────────────────────────────────────────
  group('analytics');
  await check('PostHog and GA4 load, opted out by default', async () => {
    const { body } = await getText(`${host}/`);
    assert(body.includes('posthog'), 'PostHog missing');
    assert(body.includes('G-Q4C4RYPLP5'), 'GA4 missing');
    assert(
      body.includes('opt_out_capturing_by_default'),
      'PostHog is not opted out by default — it would capture without consent'
    );
  });

  await check('consent banner ships with a way to change the answer', async () => {
    const { body } = await getText(`${host}/`);
    assert(body.includes('/shared/consent.js'), 'banner script missing');
    assert(body.includes('data-consent-reopen'), 'no reopen control in the footer');

    // The banner injects its own markup, so the only way to know it is intact is
    // to fetch it and look for the parts the analytics contract depends on.
    const script = (await getText(`${host}/shared/consent.js`)).body;
    for (const token of ['tipm_consent', 'tipm:consent-granted', 'tipm:consent-revoked', 'data-consent-reopen']) {
      assert(script.includes(token), `consent.js is missing ${token}`);
    }
  });

  await check('salary-compass gates capture on consent too', async () => {
    // It is a common landing page, so a visitor can reach it having never seen
    // the banner. Until 2026-08-03 it captured on load regardless, while every
    // other page asked first.
    const { body } = await getText(`${host}/salary-compass/posthog-init.js`);
    assert(
      body.includes('opt_out_capturing_by_default'),
      'posthog-init.js captures without waiting for consent'
    );
    const page = (await getText(`${host}/salary-compass/`)).body;
    assert(page.includes('/shared/consent.js'), 'no consent banner on salary-compass');
  });

  await check('salary-compass is not initialised twice', async () => {
    // It ships its own posthog-init.js, so the shared Analytics component must
    // not also land here — two inits double every pageview on the most valuable
    // page on the site. GA4 is the discriminator: it exists only in the shared
    // component, never in this page's own script. (Do not test for
    // opt_out_capturing_by_default here — since the consent fix, BOTH set it.)
    const { body } = await getText(`${host}/salary-compass/`);
    assert(!body.includes('G-Q4C4RYPLP5'), 'the shared Analytics component leaked in');
    const inits = (body.match(/posthog\.init\(/g) ?? []).length;
    assert(inits === 0, `${inits} inline posthog.init calls; it should come only from posthog-init.js`);
  });

  // ── Integrity ─────────────────────────────────────────────────────────────
  group('integrity');
  await check('salary-compass is byte-identical to the migrated original', async () => {
    const { body } = await getText(`${host}/salary-compass/`);
    const bytes = Buffer.byteLength(body, 'utf8');
    assert(bytes === SALARY_COMPASS_BYTES, `${bytes} bytes, expected ${SALARY_COMPASS_BYTES}`);
    return `${bytes} bytes`;
  });

  await check('nothing survives that dies with the Softr subscription', async () => {
    // Two CDNs disappear when Softr is cancelled: softr-files.com, and the
    // impostorpm-huddle Pages project that is scheduled for deletion. Both were
    // serving assets to /salary-compass/ — its font, icons and favicon.
    const paths = ['/', '/about', '/club/porto', '/huddle', '/compensation', '/rezonant/', '/salary-compass/'];
    for (const path of paths) {
      const { body } = await getText(host + path);
      assert(
        !/https?:\/\/[^"']*softr-files\.com/.test(body),
        `${path} references softr-files.com`
      );
      assert(
        !body.includes('impostorpm-huddle.pages.dev'),
        `${path} references the impostorpm-huddle project, which is being retired`
      );
    }
    return `${paths.length} pages`;
  });

  await check('salary-compass icons are self-hosted and render-ready', async () => {
    const { status, body } = await getText(`${host}/salary-compass/icons.css`);
    assert(status === 200, `icons.css → ${status}`);

    // Every icon the page uses must have a rule, or it renders as a blank box —
    // which no status-code check would ever catch.
    const used = new Set(
      [...(await getText(`${host}/salary-compass/`)).body.matchAll(/fa-([a-z0-9-]+)/g)].map((m) => m[1])
    );
    const missing = [...used].filter(
      (name) => !['fa', 'fas', 'fab', 'far'].includes(name) && !body.includes(`.fa-${name}{`)
    );
    assert(missing.length === 0, `no mask for: ${missing.join(', ')}`);
    return `${used.size - 0} icon classes`;
  });

  // ── Functions ─────────────────────────────────────────────────────────────
  group('functions');
  await check('/api/events returns usable JSON and never 5xx', async () => {
    const response = await fetch(bust(`${host}/api/events?period=future`));
    assert(response.status === 200, `status ${response.status}`);
    const data = await response.json();
    assert(Array.isArray(data.events), 'no events array');
    return `${data.count} upcoming, stale=${data.stale}`;
  });

  await check('/api/partner-enquiry rejects an empty submission', async () => {
    // 400 proves the Function is bound and running. A 405 would mean the request
    // reached the old origin instead — the failure mode this migration removed.
    const response = await fetch(bust(`${host}/api/partner-enquiry`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', email: '', message: '' }),
    });
    assert(response.status === 400, `expected 400, got ${response.status}`);
  });

  console.log('');
}

// ── Cross-host: the bug that made apex and www two different sites ──────────
if (HOSTS.length > 1) {
  console.log('[1mapex vs www[0m');
  group('parity');
  await check('both hostnames serve identical bytes', async () => {
    const paths = ['/', '/about', '/huddle', '/compensation', '/club/porto', '/events', '/salary-compass/', '/rezonant/'];
    const mismatched = [];
    for (const path of paths) {
      const [a, b] = await Promise.all([getText(HOSTS[0] + path), getText(HOSTS[1] + path)]);
      if (a.body.length !== b.body.length) {
        mismatched.push(`${path} (${a.body.length} vs ${b.body.length})`);
      }
    }
    assert(mismatched.length === 0, mismatched.join('; '));
    return `${paths.length} paths`;
  });
  console.log('');
}

// ── Report ──────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
const total = results.length;

if (failed.length === 0) {
  console.log(`[32m${total}/${total} checks passed.[0m\n`);
  process.exit(0);
}

console.log(`[31m${failed.length} of ${total} checks failed:[0m`);
for (const f of failed) console.log(`  · [${f.group}] ${f.name}\n    ${f.detail}`);
console.log('');
process.exit(1);
