import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const faqSchema = z.array(z.object({ q: z.string(), a: z.string() })).default([]);

const seoSchema = z.object({
  title: z.string(),
  description: z.string(),
  ogImage: z.string().optional(),
  /** Only when the canonical must differ from the page's own URL. */
  canonical: z.string().optional(),
});

const clubs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/clubs' }),
  schema: z.object({
    city: z.string(),
    country: z.string(),
    status: z.enum(['active', 'waitlist', 'deprecated']).default('waitlist'),
    order: z.number().int().default(99),

    /**
     * How this club's events are filed IN LUMA, which is not how the club is
     * named here. Derived from a dump of every past event, not guessed:
     * /club/lisbon has to match "Lisboa"; Porto community events appear under
     * "Matosinhos" and "Maia"; and the region comes back as both "Porto" and
     * "Porto District". Getting this wrong drops events silently.
     */
    lumaCities: z.array(z.string()).min(1),

    hero: z.object({
      title: z.string(),
      subtitle: z.string(),
      image: z.string().optional(),
      imageAlt: z.string().default(''),
    }),

    /**
     * Shown only when the club has no upcoming Luma event.
     *
     * ctaUrl is optional because the cities genuinely differ on Softr: Hamburg
     * offers a waiting list ("we'll email you as soon as the next Club goes
     * live"), while Lisbon just says "There's currently no Club planned in your
     * city. We'll be back soon!" with nothing to click.
     */
    waitlist: z.object({
      enabled: z.boolean().default(true),
      eyebrow: z.string().default("No upcoming Club? Don't worry."),
      body: z.string(),
      ctaLabel: z.string().default('Join Waiting List'),
      ctaUrl: z.string().url().optional(),
    }),

    pastClubs: z.object({
      title: z.string().default('Check out our past Clubs'),
      source: z.enum(['luma', 'manual']).default('luma'),
      limit: z.number().int().min(1).max(12).default(6),
      /** Fallback for a new city with no Luma history yet — Hamburg has none. */
      manualItems: z
        .array(z.object({ title: z.string(), image: z.string(), url: z.string().url() }))
        .default([]),
    }),

    cta: z.object({
      title: z.string().default('Already excited?'),
      body: z.string().default(''),
      label: z.string(),
      url: z.string().url(),
    }),

    faq: faqSchema,

    /** Escape hatch for a city that does not fit the shared template. */
    extraSections: z
      .array(z.object({ id: z.string(), title: z.string(), body: z.string() }))
      .default([]),

    seo: seoSchema,
  }),
});

const partners = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/partners' }),
  schema: z.object({
    name: z.string(),
    kind: z.enum(['perk', 'partner', 'event', 'program']).default('perk'),
    tagline: z.string(),
    logo: z.string().optional(),
    logoAlt: z.string().default(''),

    hero: z.object({
      title: z.string(),
      subtitle: z.string(),
      image: z.string().optional(),
    }),

    offer: z.object({
      headline: z.string(),
      body: z.string(),
      bullets: z.array(z.string()).default([]),
      code: z.string().optional(),
      ctaLabel: z.string(),
      /**
       * Absolute for a partner's own site, or a site-relative path when the CTA
       * points at one of our own pages (the Land Cowork booking form). An
       * absolute www.impostor.pm URL would work in production but sends you off
       * the preview deployment mid-test.
       */
      ctaUrl: z.union([z.string().url(), z.string().startsWith('/')]),
      /** So a dead perk is detectable instead of quietly wrong. */
      expiresAt: z.coerce.date().optional(),
    }),

    about: z.object({ title: z.string(), body: z.string() }).optional(),
    faq: faqSchema,

    /** Whether it appears on /benefits. */
    listed: z.boolean().default(true),
    order: z.number().int().default(99),

    seo: seoSchema,
  }),
});

export const collections = { clubs, partners };
