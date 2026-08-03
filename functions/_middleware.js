/**
 * Keep preview hosts out of the index.
 *
 * Every deploy is reachable at <hash>.<project>.pages.dev as well as at the
 * custom domain. Those are byte-identical copies of the real pages, so once
 * Google finds one it has a duplicate of the entire site — and it competes with
 * impostor.pm for the same queries. A `_headers` file cannot express this
 * because it has no access to the request host; middleware can.
 *
 * Keyed on the hostname rather than an env var so it keeps working on every
 * future preview deploy without anyone remembering to set it, and it can never
 * fire on the production domain.
 *
 * Two cheap exits before touching the response. A root _middleware runs on
 * EVERY request, images and CSS included, and rebuilding each one as a new
 * Response streams the whole body back through the Worker — measured at roughly
 * a 7% rate of 522s on a fresh project when it wrapped everything. Only HTML
 * can be indexed as a duplicate page, so only HTML is worth paying for.
 */
export async function onRequest(context) {
  const isPreview = new URL(context.request.url).hostname.endsWith('.pages.dev');
  if (!isPreview) return context.next();

  const response = await context.next();
  if (!response.headers.get('content-type')?.includes('text/html')) return response;

  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
