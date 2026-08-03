/**
 * Serves impostor.pm from the `impostorpm-site` Pages project.
 *
 * Why a proxy Worker rather than a Pages custom domain: the apex A record has to
 * keep pointing at Softr for as long as any path still comes from Softr, and DNS
 * is the one part of this migration that cannot be rolled back in seconds. A
 * Worker route is bound and unbound instantly, so the cutover and its rollback
 * are the same size. It is also the pattern the zone already uses — this is a
 * third copy of `salary-compass-proxy`, not a new idea.
 *
 * Once the zone has been quiet for a couple of weeks this should be replaced by
 * a real Pages custom domain: one less hop, and the middleware below stops
 * needing the exception.
 */

const UPSTREAM = 'https://impostorpm-site.pages.dev';

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    const upstream = new URL(incoming.pathname + incoming.search, UPSTREAM);

    // Passing `request` as init preserves method, body and headers, which is
    // what makes POST /api/* work through here.
    const response = await fetch(new Request(upstream, request));

    const headers = new Headers(response.headers);

    // functions/_middleware.js stamps noindex on anything served from a
    // *.pages.dev hostname, and from the origin's point of view that is exactly
    // what this request is — the proxy rewrote the host. Left alone it would
    // deindex the entire site. Stripped here rather than by teaching the
    // middleware about a forwarded-host header, so that the middleware stays
    // correct for genuine preview deploys with no special case in it.
    //
    // Page-level noindex is unaffected: Seo.astro emits a <meta> robots tag,
    // which is in the body and never passes through this.
    headers.delete('x-robots-tag');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
