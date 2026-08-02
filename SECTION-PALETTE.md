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
