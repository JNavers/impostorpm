/**
 * Shared event shape and formatting, used by both the build-time fetch and the
 * client island so a card looks the same before and after the swap.
 */

export type TipmEvent = {
  id: string;
  name: string;
  url: string;
  start_at: string;
  end_at: string | null;
  timezone: string;
  cover_url: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  address: string | null;
  location_type: string | null;
  event_type: string | null;
  /** Luma tags, e.g. ["Club", "Porto"] or ["Product Talks"]. */
  tags: string[];
};

export type EventsResponse = {
  period: 'future' | 'past';
  generated_at: string;
  stale: boolean;
  degraded?: boolean;
  count: number;
  events: TipmEvent[];
};

const CALENDAR_ID = 'cal-CLQWhEvG4XO5aVF';
export const LUMA_CALENDAR_URL = 'https://luma.com/impostorpm';
export const LUMA_ICS_URL = `https://api.lu.ma/ics/get?entity=calendar&id=${CALENDAR_ID}`;

/**
 * Build-time fetch. Talks to Luma directly rather than to our own Function,
 * which is not running yet during `astro build`.
 *
 * The markup it produces is a fallback that the island replaces on load: it
 * avoids an empty flash and keeps the page working without JS, and is never
 * worse than one deploy out of date.
 */
export async function fetchEventsAtBuild(
  period: 'future' | 'past',
  limit = 12
): Promise<TipmEvent[]> {
  const endpoint =
    `https://api.lu.ma/calendar/get-items?calendar_api_id=${CALENDAR_ID}` +
    `&period=${period}&pagination_limit=100`;

  const response = await fetch(endpoint, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Luma responded ${response.status} for period=${period}`);

  const data = (await response.json()) as { entries?: { event: Record<string, any>; tags?: { name?: string }[] }[] };
  if (!Array.isArray(data.entries)) throw new Error('Luma returned an unexpected shape');

  return data.entries
    .filter((entry) => entry.event?.api_id && entry.event?.start_at)
    .map(({ event, tags }) => ({
      id: event.api_id,
      name: event.name ?? '',
      url: event.url ? `https://luma.com/${event.url}` : LUMA_CALENDAR_URL,
      start_at: event.start_at,
      end_at: event.end_at ?? null,
      timezone: event.timezone ?? 'Europe/Lisbon',
      cover_url: event.cover_url ?? null,
      city: event.geo_address_info?.city ?? null,
      region: event.geo_address_info?.region ?? null,
      country: event.geo_address_info?.country ?? null,
      address: event.geo_address_info?.address ?? null,
      location_type: event.location_type ?? null,
      event_type: event.event_type ?? null,
      tags: Array.isArray(tags) ? tags.map((t) => t?.name).filter(Boolean) as string[] : [],
    }))
    .sort((a, b) =>
      period === 'past'
        ? Date.parse(b.start_at) - Date.parse(a.start_at)
        : Date.parse(a.start_at) - Date.parse(b.start_at)
    )
    .slice(0, limit);
}

/** Rendered in the event's own timezone, not the visitor's — a Porto Club at
 *  18:30 local should read 18:30 to someone browsing from Berlin. */
export function formatMonth(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: timezone }).format(
    new Date(iso)
  );
}

export function formatDay(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', timeZone: timezone }).format(
    new Date(iso)
  );
}

export function formatTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  }).format(new Date(iso));
}

export function locationLabel(event: TipmEvent): string {
  if (event.location_type === 'online') return 'Online';
  if (event.city) return event.city;
  if (event.region) return event.region;
  return 'TBA';
}
