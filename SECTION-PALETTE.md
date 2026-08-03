# Section backgrounds, measured off the live Softr pages

Section background is part of the design, not a default. Getting it wrong is
invisible in a build log and obvious on screen — this is the reference, and it
was measured, not eyeballed.

| Page | Pattern |
|---|---|
| `/club` | PHOTO → WARM → WHITE → DARK → WARM → WHITE → GOLDEN |
| `/club/<city>` | WHITE → WARM → **DARK** → WARM → GOLDEN → WHITE |
| `/club/how-we-select` | WHITE → WHITE → WHITE → WHITE |
| `/about` | all WHITE |
| `/group` | all WHITE |
| `/product-talks` | all **CREAM `#f1efe7`** |
| `/bring-the-club-to-my-city` | WARM → WHITE → WARM → WHITE → GOLDEN |

Names map to the helpers in `src/styles/base.css`: `.section-warm` `#fff3cf`,
`.section-white`, `.section-dark` `#1e1e1e`, `.section-golden` `#ffc600`,
`.section-cream` `#f1efe7`.

## How to measure a page

Softr is client-rendered, so read the computed style in a browser after the page
has settled — do not infer it from a screenshot:

```js
function bgOf(el){let n=el;for(let i=0;i<10&&n;i++){
  const c=getComputedStyle(n).backgroundColor;
  if(c&&c!=='rgba(0, 0, 0, 0)'&&c!=='transparent')return c;n=n.parentElement;}return 'none';}
[...document.querySelectorAll('h1,h2')].map(h => bgOf(h) + ' | ' + h.textContent.trim());
```

## What went wrong the first time

- Section colours were **assumed** rather than measured, and came out inverted
  on `/club`: warm where the original is white and vice versa.
- `#f1efe7` was not in the token set at all, so `/product-talks` — a page that is
  entirely that colour — was built white.
- Sections were **invented**: a golden CTA at the end of `/about` and `/group`
  that the original does not have. Removed.
- Two sections that are separate on `/bring-the-club-to-my-city` (one WHITE, one
  WARM) had been merged into a single two-column block, which erased a colour
  change.

Before shipping a migrated page, run the snippet above against the Softr original
and diff it against the built page.

## Background is not the only thing to measure

`/bring-the-club-to-my-city` matched on colour and still did not match the page.
Two more things have to be checked per section:

**Which side the image is on.** The original alternates — hero right, "What are
we looking for?" **left**, "What can you expect?" right. I had put every image on
the right, which made two consecutive sections read as the same block twice.

```js
// per section: is the image left or right of the heading?
for (const h of document.querySelectorAll('h1,h2')) {
  let box = h; for (let i=0;i<7;i++){ if (box.parentElement && box.parentElement.innerText.length < 900) box = box.parentElement; else break; }
  const img = box.querySelector('img'); if (!img) continue;
  console.log(h.textContent.trim(), img.getBoundingClientRect().left > h.getBoundingClientRect().left ? 'RIGHT' : 'LEFT');
}
```

**Whether a list is really a list.** The city grid here is the same six landmark
illustrations as on `/club`, not text chips — and they are `background-image`, so
they never appear in an `<img>` scrape. Shared as `src/components/CityGrid.astro`
so the two pages cannot drift.

### Comparing the copy

`DOMParser` does not do layout, so `innerText` on a parsed document runs block
elements together and the word diff comes back full of joins like `succeed.Join`.
Append a space to every block element before comparing, or the diff is noise.

## Buttons

One shape everywhere, measured off the live `/huddle` page:

| | Primary | Dark | Outline |
|---|---|---|---|
| class | `.btn-cta` / `.btn-accent` | `.btn-cta-dark` / `.btn-dark` | `.btn-outline-custom` |
| background | `#ffc600` | `#1e1e1e` | transparent |
| text | `#1e1e1e` | `#ffffff` | `#000000` |
| border | none | none | `1.5px solid #000` |
| radius | **4px** | 4px | 4px |
| padding | **`.65rem 1.75rem`** | same | same |
| size / weight | **16px / 500** | 16px / 400 | 16px / 400 |

`.btn-lg-custom` is the only size modifier: `.85rem 2.5rem` at 18px. **Do not
resize a button with a per-page rule** — two had drifted that way (`/compensation`
and `/product-talks-link-to-the-talk`) and neither was visible without measuring.

`.btn-cta` and `.btn-accent` are the same button under two names: the migrated
pages were written against one and `/huddle` against the other. They resolve to a
single rule in `base.css` so they cannot drift apart.

This **supersedes** the earlier `.btn-cta` spec (8px radius / `.65rem 1.25rem` /
15px / weight 600).

`.btn-nav` is deliberately not in this set — it is chrome, sized to fit the 56px
navbar (6px radius, 14px).

### Verify

```js
// every button on a page should report r=4px p=10.4px 28px f=16px
[...document.querySelectorAll('.btn-cta,.btn-cta-dark,.btn-accent,.btn-dark,.btn-outline-custom')]
  .map(b => { const c = getComputedStyle(b);
    return `${b.textContent.trim()} r=${c.borderRadius} p=${c.padding} f=${c.fontSize}`; });
```

## Mobile

Below `767.98px` the content centres. This is what the Softr original does —
measured at a 416px viewport, where every heading and paragraph switches to
`text-align: center` while the footer stays left. One rule at the bottom of
`base.css`, not per page.

Three things stay left on purpose:

- **The footer**, which the original leaves left-aligned.
- **Forms**, where a centred label floating over a full-width input is harder to
  scan.
- **Event cards**, whose date / title / action columns come apart if their text
  is centred.

Bullet lists are centred as a **block** (`inline-block` + `text-align: left`), so
the group sits in the middle while the markers stay in one column. Centring each
line individually leaves the bullets ragged.

### Measuring the original at mobile

`resize_window` does not change the viewport for this setup — `innerWidth` stays
at 1200. Use a narrow iframe instead, which gives the embedded document a real
viewport that media queries respond to:

```js
const f = document.createElement('iframe');
f.style.cssText = 'width:420px;height:900px;position:fixed;left:-9999px';
f.src = 'https://www.impostor.pm/club';
document.body.append(f);
```

**Read it on first load and do not resize.** Softr renders client-side and picks
its layout at mount, so resizing an already-loaded frame keeps the mobile layout
and every later measurement is wrong. Cross-origin also blocks reading the frame,
so measure the Softr original from a page on `impostor.pm`, and the migrated site
from a page on `impostorpm-site.pages.dev`.

### Hero sizes at mobile

Not one value — the original uses a different size per page, so each page carries
its own in its own `@media` block rather than inheriting a site default.

| Page | h1 @ ≤767px | line-height |
|---|---|---|
| `/` · `/club` | 48px | `/club` is 1.0, the rest 1.5 |
| `/bring-the-club-to-my-city` · `/product-talks` · `/boost` · `/club/how-we-select` | 48px | 1.5 |
| `/about` · `/group` | 36px | 1.5 |
| `/club/<city>` | **30px** | 1.5 |

The city pages are the odd one out and go **smaller**, not larger — a detail that
would never be guessed from the desktop layout.

`/huddle` and `/compensation` are excluded on purpose: neither has a Softr
original to match. `/huddle` 404s there and `/compensation` on Softr is a
different page entirely, so both keep their own authored hero.

### Section headings at mobile

Also per page, also measured:

| Page | h2 @ ≤767px |
|---|---|
| `/` · `/club` · `/product-talks` · `/boost` · `/club/<city>` | 30px / 1.5 |
| `/about` | 32px / 1.2 |
| `/group` · `/bring-the-club-to-my-city` | 36px / 1.5 |
| `/club/how-we-select` | 24px / 1.5 |

### Three ways a mobile size rule silently loses

All three happened here, and none of them shows up in a build log:

1. **An inline `style` attribute.** `"What we do"` on the homepage carried
   `style="font-size:2.25rem"`, which beats every stylesheet rule. Removed in
   favour of a class.
2. **Lower specificity.** A bare `h2 { }` inside a page's scoped block loses to
   `.about-body h2`. Target the same selector the desktop rule uses.
3. **Rule order.** A `@media` block placed in the MIDDLE of a stylesheet loses to
   an equal-specificity rule further down. The homepage's mobile block sat before
   `.mh-section h2` and lost to it. Put mobile overrides at the end.

Verify by measuring, never by reading the CSS:

```js
[...document.querySelectorAll('h1,h2')]
  .filter(h => !h.closest('footer,nav'))
  .map(h => { const c = getComputedStyle(h);
    return `${c.fontSize}/${c.lineHeight}  ${h.textContent.trim().slice(0,30)}`; });
```


## The section background can be an IMAGE

`/about` and `/group` measured as "all white" through three different probes, and
were not. The warm and coral washes on those pages are **`background-image`
pointing at an SVG** that holds a two-stop linear gradient — not a
`background-color`, and not a CSS gradient either, so nothing that reads
`backgroundColor` or greps for `gradient` will ever see them.

Reproduced in CSS from the SVG's own stops, so no image ships:

| class | stops |
|---|---|
| `.section-gradient-warm` | `#ffef99 → #ffae63`, 90deg |
| `.section-gradient-coral` | `#ffaaad → #ffef99`, 90deg |

Where they go: `/about` "Our Mission" is warm; `/group`'s hero is warm.

### How to measure it

Walking up the DOM does not work — a white wrapper wins before you reach the
section. Neither does "widest covering element", for the same reason. Sample the
element actually painted at a point, then walk up until something has *either* a
background image or a background colour:

```js
window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 250);
const el = document.elementFromPoint(30, Math.round(h.getBoundingClientRect().top + 10));
let n = el;
for (let i = 0; i < 8 && n; i++) {
  const s = getComputedStyle(n);
  if (s.backgroundImage !== 'none') { console.log('IMG', s.backgroundImage); break; }
  if (s.backgroundColor !== 'rgba(0, 0, 0, 0)') { console.log('COL', s.backgroundColor); break; }
  n = n.parentElement;
}
```

Set `scroll-behavior: auto` first, or the scroll has not landed when you sample.

## Wait for the deploy before verifying

Cloudflare takes ~15-20s to propagate. Measuring sooner returns the previous
build, and has repeatedly made a correct change look broken — and once made a
working tag filter look like it was returning unfiltered results. Wait, then
measure.
