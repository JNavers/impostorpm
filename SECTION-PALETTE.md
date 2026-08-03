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
