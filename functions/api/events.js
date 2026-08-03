/**
 * Luma calendar proxy.
 *
 * The events shown on the site are the ones already being created in Luma;
 * anything else means maintaining the same list twice. Luma's calendar endpoint
 * is public and unauthenticated, so this is a cache in front of it rather than
 * an integration.
 *
 *   GET /api/events?period=future|past&cities=Porto,Matosinhos&limit=6
 *
 * Upstream is always fetched with a fixed pagination_limit regardless of what
 * the caller asked for, so the cache key space is exactly two entries. Filtering
 * and slicing happen here, on an already-cached payload.
 */

const CALENDAR_ID = 'cal-CLQWhEvG4XO5aVF';
const UPSTREAM_LIMIT = 100;
const FRESH_TTL = 600; // 10 min
const LKG_TTL = 86400; // 24 h — the "last known good" copy
const UPSTREAM_TIMEOUT_MS = 4000;
const MAX_LIMIT = 100;

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const period = url.searchParams.get('period') === 'past' ? 'past' : 'future';
  const limit = clampLimit(url.searchParams.get('limit'));
  const cities = parseCities(url.searchParams.get('cities'));
  const tags = parseCities(url.searchParams.get('tags'));

  const cache = caches.default;
  const freshKey = new Request(`${url.origin}/__cache/events/${period}`);
  const lkgKey = new Request(`${url.origin}/__cache/events/${period}/lkg`);

  let payload = await readCache(cache, freshKey);
  let stale = false;

  if (!payload) {
    try {
      payload = await fetchUpstream(period);
      context.waitUntil(writeCache(cache, freshKey, payload, FRESH_TTL));
      context.waitUntil(writeCache(cache, lkgKey, payload, LKG_TTL));
    } catch (error) {
      // Never surface a 5xx. A failed island renders as a broken widget; an
      // empty-but-successful response renders the empty state that was designed.
      payload = await readCache(cache, lkgKey);
      stale = true;
      if (!payload) {
        return json(
          { period, generated_at: new Date().toISOString(), stale: true, degraded: true, count: 0, events: [] },
          { 'Cache-Control': 'public, max-age=60', 'X-TIPM-Events-Error': String(error).slice(0, 120) }
        );
      }
    }
  }

  const events = filterByTags(filterByCities(payload.events, cities), tags).slice(0, limit);

  return json(
    { period, generated_at: payload.generated_at, stale, count: events.length, events },
    stale
      ? { 'Cache-Control': 'public, max-age=60', 'X-TIPM-Events-Stale': '1' }
      : { 'Cache-Control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=1800' }
  );
}

/* ── upstream ─────────────────────────────────────────────────────────────── */

async function fetchUpstream(period) {
  const endpoint =
    `https://api.lu.ma/calendar/get-items?calendar_api_id=${CALENDAR_ID}` +
    `&period=${period}&pagination_limit=${UPSTREAM_LIMIT}`;

  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`luma ${response.status}`);

  const data = await response.json();
  if (!Array.isArray(data?.entries)) throw new Error('luma: unexpected shape');

  const events = data.entries
    .map((entry) => normalise(entry.event, entry.tags))
    .filter(Boolean)
    .sort((a, b) =>
      period === 'past'
        ? Date.parse(b.start_at) - Date.parse(a.start_at)
        : Date.parse(a.start_at) - Date.parse(b.start_at)
    );

  return { generated_at: new Date().toISOString(), events };
}

/**
 * Keep the ~15 fields a card needs. Luma's payload is ~200 KB for 17 events,
 * almost all of it colour palettes, place_ids and localised address variants.
 */
function normalise(event, tags) {
  if (!event?.api_id || !event?.start_at) return null;
  const geo = event.geo_address_info ?? {};

  return {
    id: event.api_id,
    name: event.name ?? '',
    url: event.url ? `https://luma.com/${event.url}` : 'https://luma.com/impostorpm',
    start_at: event.start_at,
    end_at: event.end_at ?? null,
    timezone: event.timezone ?? 'Europe/Lisbon',
    cover_url: event.cover_url ?? null,
    // Manually-entered venues have no city/region at all — only a free-text
    // address. Keeping it is what lets the city filter still match them.
    city: geo.city ?? null,
    region: geo.region ?? null,
    country: geo.country ?? null,
    address: geo.address ?? null,
    location_type: event.location_type ?? null,
    event_type: event.event_type ?? null,
    /* Luma's own tags, which the calendar already uses to mark the event TYPE
       (a yellow "Club" / "Huddle" tag) alongside a red city tag. That existing
       habit is what lets /product-talks pick up future Talks with no extra
       tooling: tag it "Product Talks" in Luma and it appears. */
    tags: Array.isArray(tags) ? tags.map((t) => t?.name).filter(Boolean) : [],
  };
}

/* ── city matching ────────────────────────────────────────────────────────── */

/**
 * Accent- and case-insensitive. Luma writes the Portuguese city names, so the
 * club at /club/lisbon has to match events filed under "Lisboa"; a Porto
 * community event may be filed under "Matosinhos" or "Maia"; and the region
 * comes back as both "Porto" and "Porto District". Alias lists live in the
 * clubs content collection, not here, so city knowledge has one home.
 */
function fold(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function parseCities(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map(fold)
    .filter(Boolean)
    .slice(0, 12);
}

function filterByCities(events, cities) {
  if (!cities.length) return events;
  return events.filter((event) => {
    const city = fold(event.city);
    const region = fold(event.region);
    const address = fold(event.address);
    return cities.some(
      (needle) =>
        city === needle ||
        region === needle ||
        // Substring only against the free-text address, and only as a last
        // resort: exact matching would drop the manually-entered venues.
        (!city && !region && address.includes(needle))
    );
  });
}

/** Match on Luma's tags. Case- and accent-insensitive like the city filter. */
function filterByTags(events, tags) {
  if (!tags.length) return events;
  return events.filter((event) => (event.tags ?? []).some((t) => tags.includes(fold(t))));
}

/* ── plumbing ─────────────────────────────────────────────────────────────── */

function clampLimit(raw) {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n) || n < 1) return 12;
  return Math.min(n, MAX_LIMIT);
}

async function readCache(cache, key) {
  const hit = await cache.match(key);
  if (!hit) return null;
  try {
    return await hit.json();
  } catch {
    return null;
  }
}

async function writeCache(cache, key, payload, ttl) {
  await cache.put(
    key,
    new Response(JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${ttl}`,
      },
    })
  );
}

function json(body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}
