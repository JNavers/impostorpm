/**
 * First-party ingestion path for PostHog.
 *
 * Blocker lists drop 10-25% of analytics events by matching the destination
 * host. PostHog's own managed proxy answers this with a subdomain, and its setup
 * screen concedes the weakness: subdomains get added to those same lists, by
 * keyword and by CNAME. A path on the origin the site is already served from
 * cannot be blocked without breaking the site, so this is the version that keeps
 * working.
 *
 * Same origin as the page, so there is no CORS to configure and no preflight —
 * which also removes the failure mode that broke the Salary Compass email
 * endpoint for weeks.
 *
 * PostHog splits its traffic across two hosts and they are not interchangeable:
 * static assets (the library, surveys, web-vitals) come from the assets host,
 * everything else — events, /decide, /flags — from the ingestion host. Routing
 * both to one of them silently breaks whichever half guessed wrong.
 */

const ASSET_HOST = 'https://eu-assets.i.posthog.com';
const INGEST_HOST = 'https://eu.i.posthog.com';

export async function onRequest(context) {
  const url = new URL(context.request.url);

  // Everything after /ingest, e.g. /ingest/e/?ver=1 -> /e/?ver=1
  const path = url.pathname.replace(/^\/ingest/, '') || '/';
  const host = path.startsWith('/static/') ? ASSET_HOST : INGEST_HOST;
  const target = new URL(path + url.search, host);

  // Passing the original request as init keeps the method and body, which is
  // what makes the POSTed event batches arrive intact.
  const upstream = new Request(target, context.request);

  // The Host header has to describe the upstream, not us, or PostHog routes the
  // request to the wrong project shard.
  upstream.headers.set('host', new URL(host).host);
  // Our own hostname is not PostHog's business and would end up in their logs.
  upstream.headers.delete('cookie');

  const response = await fetch(upstream);

  // Assets are immutable and versioned; letting the edge hold them keeps this
  // path off the critical path for every pageview.
  const headers = new Headers(response.headers);
  if (path.startsWith('/static/')) {
    headers.set('cache-control', 'public, max-age=86400');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
