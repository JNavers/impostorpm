/**
 * Structured data builders.
 *
 * Everything here is derived from data the page already renders — Luma's event
 * feed, the club collection's FAQs, SITE. Nothing is written twice, because
 * JSON-LD that disagrees with the visible page is worse than none: Google treats
 * that as spam, and it drifts silently since nobody reads it.
 *
 * Until 2026-08-03 only /compensation had any. The club pages carry real events
 * with dates and venues and four FAQs each, which is the richest unused signal
 * on the site.
 */

import { SITE, SOCIALS } from './site';
import type { TipmEvent } from './events';

const abs = (path: string) => (path.startsWith('http') ? path : `${SITE.url}${path}`);

/** The publisher, referenced by @id from the other blocks rather than repeated. */
export const ORGANISATION_ID = `${SITE.url}/#organization`;

export function organisation() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': ORGANISATION_ID,
    name: SITE.name,
    url: SITE.url,
    description: SITE.defaultDescription,
    logo: abs(SITE.logo),
    sameAs: SOCIALS.filter((s) => s.href.startsWith('http')).map((s) => s.href),
  };
}

export function webSite() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE.url}/#website`,
    url: SITE.url,
    name: SITE.name,
    description: SITE.defaultDescription,
    publisher: { '@id': ORGANISATION_ID },
  };
}

/**
 * `location` has to match what Luma actually gave us. An online event with a
 * fabricated street address, or a Place with no address at all, is an invalid
 * block — so each shape is only emitted when its data exists.
 */
function eventLocation(event: TipmEvent) {
  if (event.location_type === 'online') {
    return { '@type': 'VirtualLocation', url: event.url };
  }
  if (!event.city && !event.address) return undefined;
  return {
    '@type': 'Place',
    name: event.address ?? event.city ?? undefined,
    address: {
      '@type': 'PostalAddress',
      streetAddress: event.address ?? undefined,
      addressLocality: event.city ?? undefined,
      addressRegion: event.region ?? undefined,
      addressCountry: event.country ?? undefined,
    },
  };
}

export function event(item: TipmEvent) {
  const location = eventLocation(item);
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: item.name,
    startDate: item.start_at,
    ...(item.end_at ? { endDate: item.end_at } : {}),
    eventAttendanceMode:
      item.location_type === 'online'
        ? 'https://schema.org/OnlineEventAttendanceMode'
        : 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    ...(location ? { location } : {}),
    ...(item.cover_url ? { image: [item.cover_url] } : {}),
    url: item.url,
    organizer: { '@id': ORGANISATION_ID },
    // Every Impostor PM event is free; saying so is what makes the rich result
    // show a price rather than nothing.
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
      url: item.url,
    },
  };
}

/** Google only honours FAQPage when the answers are visible on the page too. */
export function faqPage(items: { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  };
}

export function breadcrumbs(trail: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((step, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: step.name,
      item: abs(step.path),
    })),
  };
}
