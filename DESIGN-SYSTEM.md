# The Impostor PM — design system

Every value here is read from `src/styles/tokens.css` and `src/styles/base.css`.
Those files are the source; this is the map. **If the two disagree, the CSS is
right and this file is stale** — fix it rather than working around it.

Never hard-code a hex, a size or a radius in a page. Reach for the token. The
whole point is that changing the golden once changes it in 44 places.

---

## Colour

### Accent — this is the brand

`--tipm-golden` **`#ffc600`** is the single unmistakable TIPM colour: logo
highlight, CTAs, underlines, timeline dots, chart fills. Nothing else competes
with it. Transparent steps exist for washes and glows:

| Token | Value |
|---|---|
| `--tipm-golden` | `#ffc600` |
| `--tipm-golden-10` `-20` `-40` `-60` | the same at 10/20/40/60% alpha |

### Warm backgrounds — the quiet half of the brand

The site is mostly calm and warm, and the golden lands on top of that. Overusing
the warm tones is what makes a page look muddy.

| Token | Value | Where |
|---|---|---|
| `--tipm-warm-yellow` | `#fff3cf` | the standard warm section |
| `--tipm-cream` | `#f1efe7` | whole-page wash (`/product-talks`) |
| `--tipm-warm-soft` | `#ffef99` | gradient stop, logo highlight |
| `--tipm-warm-peach` | `#ffae63` | end of the warm gradient |
| `--tipm-warm-pink` | `#ffaaad` | start of the coral gradient — sparingly |

### Neutrals

| Token | Value | Where |
|---|---|---|
| `--tipm-white` | `#ffffff` | default page background |
| `--tipm-light-gray` | `#f5f5f5` | low surface |
| `--tipm-surface` | `#f0f0f0` | container surface |
| `--tipm-outline` | `#e0e0e0` | borders |
| `--tipm-border-gray` | `#eaeff4` | soft borders |
| `--tipm-near-black` | `#1e1e1e` | body text, dark sections |
| `--tipm-black` | `#000000` | primary text |
| `--tipm-footer-bg` | `#2b2b2b` | footer only — **not** the same as dark sections |
| `--tipm-text-muted` | `#666666` | secondary copy |

### Semantic aliases

Prefer these in new work; they say what a colour is for rather than what it is.
`--fg-1` `--fg-2` `--fg-3` `--fg-inverse` `--fg-accent`, and
`--bg-1` `--bg-2` `--bg-warm` `--bg-dark` `--bg-footer`.

---

## Typography

**Inter**, from Google Fonts. Weights in use: 300 body, 400 regular, 500 button
labels, 700 headings.

Body copy is **300**, not 400. It is a light, airy page and 400 reads heavy.

### Scale

| Token | Size | Where |
|---|---|---|
| `--fs-xs` | 11px | eyebrows, uppercase labels |
| `--fs-sm` | 13px | footer, fine print |
| `--fs-s` | 14px | nav, small body |
| `--fs-base` | 16px | body |
| `--fs-m` | 17px | generous body |
| `--fs-l` | 18px | lead paragraph, h5 |
| `--fs-xl` | 20px | h4 |
| `--fs-2xl` | 22px | h3 |
| `--fs-3xl` | 24px | h2 sub |
| `--fs-4xl` | 32px | section h2 |
| `--fs-5xl` | 36px | **default h2** |
| `--fs-6xl` | 48px | section heading on dark |
| `--fs-hero` | 72px | hero h1 |

### Line-height is 1.5, everywhere

All four line-height tokens resolve to **1.5**. That is not laziness: measured off
the original, 76 of 89 size/line-height pairs across the site were exactly 1.5. It
is the rhythm of the design. A display heading at 1.2 will look "tighter and
better" in isolation and wrong next to everything else.

### Letter-spacing

`--tracking-tight: -0.04em` on h1/h2. The wide steps (`0.05` → `0.3em`) are for
uppercase labels only, and get wider as the text gets smaller.

---

## Buttons

One shape for the whole site. **4px radius, `.65rem 1.75rem` padding, 16px.**

| | Primary | Dark | Outline |
|---|---|---|---|
| class | `.btn-cta` / `.btn-accent` | `.btn-cta-dark` / `.btn-dark` | `.btn-outline-custom` |
| background | `#ffc600` | `#1e1e1e` | transparent |
| text | `#1e1e1e` | `#ffffff` | `#000000` |
| border | none | none | `1.5px solid #000` |
| weight | 500 | 400 | 400 |

- `.btn-cta` and `.btn-accent` are **aliases of one rule**, not separate
  definitions. Same for `.btn-cta-dark` / `.btn-dark`.
- `.btn-lg-custom` (`.85rem 2.5rem`, 18px) is the **only** size modifier. Never
  resize a button with a per-page rule — two pages had drifted that way and it
  was invisible without measuring.
- Inside `.section-dark` the outline button inverts automatically, or it would be
  black on black.
- `.btn-nav` is deliberately outside this system: it is chrome, sized for the
  56px bar.

---

## Sections

A page is a stack of full-width bands. The background is **part of the design,
not a default** — a page that is white all the way down is a page where someone
forgot.

| Class | Background |
|---|---|
| `.section-white` | `#ffffff` |
| `.section-light` | `#f5f5f5` |
| `.section-warm` | `#fff3cf` |
| `.section-cream` | `#f1efe7` |
| `.section-golden` | `#ffc600` |
| `.section-dark` | `#1e1e1e`, text and headings flipped to white |
| `.section-gradient-warm` | `#ffef99` → `#ffae63`, 90° |
| `.section-gradient-coral` | `#ffaaad` → `#ffef99`, 90° |

Vertical rhythm: `.section-pad` = `4rem 0`, `.section-pad-lg` = `6rem 0`.

**Alternate.** Two adjacent bands of the same colour read as one section and the
page loses its structure.

---

## Radii, shadows, motion

| Token | Value | Where |
|---|---|---|
| `--radius-xs` | 4px | buttons |
| `--radius-sm` | 6px | nav buttons, social icons |
| `--radius-md` | 8px | compact cards |
| `--radius-lg` | 12px | icon boxes |
| `--radius-xl` | 16px | modals, featured cards |
| `--radius-2xl` | 24px | pricing and fit cards |
| `--radius-pill` | 999px | pills |

Two shadows, and they mean different things:

- `--shadow-soft` — `0 18px 45px rgba(15,23,42,.08)`. Cards, forms, dropdowns.
- `--shadow-brutal` — `8px 8px 0 0 #000`. The hard offset block on modals, event
  details and pricing. This is a deliberate style signature, not a mistake.

Motion: `--dur-fast` .15s, `--dur-med` .2s, `--dur-slow` .35s, with
`--ease-standard` for anything that should feel snappy.

---

## Signature elements

- **`.tipm-eyebrow`** — 11px, bold, uppercase, `0.2em` tracking, muted. The label
  above a heading.
- **`.tipm-badge`** — golden chip, uppercase, above hero headings.
- **`.tipm-scribble`** — the hand-drawn golden underline. It is an SVG with
  `preserveAspectRatio="none"` and `background-size: 100% 100%`, so it **stretches
  to whatever text it wraps**. That is required: a fixed-width squiggle stops
  matching the moment the copy changes.

---

## Mobile

Breakpoint **767.98px**. Two rules that are easy to get wrong:

1. **Centre.** Below the breakpoint almost everything centres. The deliberate
   exceptions are the footer, form fields and `.ue-item` — they stay left.
2. **Headings stay large.** Hero drops to about 2.25rem, not to body size. The
   temptation is to shrink further; the original does not, and the page loses its
   voice when you do.

A per-page mobile rule can lose silently in three ways: an inline `style`
attribute beats it, a lower-specificity selector loses to a desktop rule, and a
`@media` block placed mid-stylesheet gets overridden by what follows. If a mobile
size "does not apply", check those three before changing the value.

---

## Where things live

```
src/styles/tokens.css   the 59 tokens + base element styles
src/styles/base.css     20 shared components (nav, footer, buttons, sections)
src/lib/site.ts         nav, footer groups, socials, copyright
```

Page-specific CSS belongs in a `<style>` block in the `.astro` file, where Astro
scopes it. A rule that is not in `base.css` **cannot** leak to another page —
that is the safety valve, and it is why not everything needs promoting.

Historical note: `docs/migration-fidelity-notes.md` records how these values were
measured off the original Softr site and the mistakes made doing it. Useful if a
value here ever looks wrong; not needed for day-to-day work.
