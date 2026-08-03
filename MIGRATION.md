# Migration status

Moving impostor.pm off Softr. Full plan:
`~/Documents/JAVI WORKSPACE/.claude/plans/quiero-migrar-mi-web-validated-horizon.md`

## What serves what, right now

**Cutover done 2026-08-03.** impostor.pm is served from the `impostorpm-site` Pages
project via the `impostorpm-site-proxy` Worker on `impostor.pm/*` and
`*.impostor.pm/*`. Softr no longer serves any page: 39/39 sitemap URLs resolve on
both hostnames, the `created in Softr` marker is gone from every sampled page,
`/salary-compass/` is still byte-identical at 274260, and no `X-Robots-Tag` leaks
to production.

`/api/*` now reaches the Pages Functions, so the Salary Compass email endpoint
stopped 405ing on its own, exactly as predicted — no change to the live repo.

### Cutover is complete

All seven route patterns now belong to `impostorpm-site-proxy`. The five that had
stayed with the old proxy Workers were deleted from the dashboard and claimed
here; the apex/www split on `/compensation` is gone, and every sampled path
returns identical bytes on both hostnames.

The five redundant patterns are kept listed rather than dropped: while a pattern
is unowned, whoever claims it next silently outranks `impostor.pm/*`, because the
most specific pattern wins. Holding them prevents that.

**Wrangler cannot unbind a route.** `wrangler deploy` and `wrangler triggers
deploy` both read `"routes": []` as "leave routes alone" — verified by re-reading
the deployed config afterwards, twice. Use the dashboard.

### The soft-404, found by the cutover

Cloudflare Pages runs a project in SPA mode when the output has no `404.html`,
answering every unmatched path with `index.html` at **HTTP 200**. That was live:
`/noexiste-xyz`, `/assets/nada.js` and `/club/inventado` all returned the homepage
as a success — an unbounded set of indexable duplicates of `/`.

It also meant **every sitemap sweep run before this was partly false comfort.**
A check that accepts 200 cannot distinguish a real page from the SPA fallback, so
ten dead URLs reported as passing. `src/pages/404.astro` is what surfaced them,
and they are now in `public/_redirects` with all six destinations verified 200
first. Sweeps since then follow redirects and assert a real 200 at the end.

Do not remove `src/pages/404.astro`. Without it the SPA fallback returns, and it
fails silently — the site looks fine.

### Why a proxy Worker and not a Pages custom domain

The apex A record has to keep pointing at Softr while any path still comes from
Softr, and DNS is the one part of this migration that cannot be undone in seconds.
Binding and unbinding a Worker route are the same size, so cutover and rollback
are symmetric. It is also the pattern the zone already used.

Worth replacing with a real Pages custom domain once things are quiet: one less
hop, and `functions/_middleware.js` stops needing the `X-Robots-Tag` exception the
proxy makes for it.

## Duplicated files, deliberately

Two copies exist while the Pages projects are still separate. Both must be
edited together until the projects are consolidated (Phase 2/5).

- `rezonant/` (repo root) — what `impostorpm-rezonant` actually deploys today.
- `public/rezonant/` — the Astro-era location, and the future single source.

Same story for `huddle/`, `compensation/`, `salary-compass/` at the repo root:
they are the pre-Astro pages. `huddle/` is now superseded by
`src/pages/huddle.astro` and is kept only as the reference for visual diffing;
delete it once `/huddle` is live from this project.

## Build gate

`npm run build` runs `scripts/check-no-softr.mjs` first. It fails if any file
under `src/`, `public/` or `functions/` gains a URL pointing at
`softr-files.com` or `impostorpm-huddle.pages.dev`. Per-file budgets live in
that script; they may only go down.

## Phase 1 done

- Astro 7 scaffold, static output, `trailingSlash: 'never'` + `build.format: 'file'`
  so URLs stay slash-less exactly as Softr and the sitemap have them.
- `src/styles/tokens.css` is the single source of design tokens.
- `src/styles/base.css` holds the chrome that was copy-pasted across pages.
- Nav/footer/socials/copyright come from `src/lib/site.ts`.
- jQuery, Popper and Bootstrap JS dropped (~130 KB). Bootstrap **CSS** stays.
- Font Awesome replaced by inline SVG in `src/components/Icon.astro`.
- Favicon self-hosted; `rezonant` has zero Softr references left.

## Phase 2 done

- `salary-compass` folded in via `git subtree` (no --squash); 37 commits preserved.
  Its repo is now **frozen at 57db276** — do not commit there again, or the two
  copies diverge and have to be reconciled by hand.
- Duplicate files resolved by inspection: the email Function, `Code.gs`, and the
  root `salary-compass/index.html`. See that commit message for which won and why.
- `/compensation` converted to `.astro` from the 79,233-byte version.
  `.btn-cta` / `.btn-cta-dark` (15px / .65rem 1.25rem / 8px) and `.section-golden`
  promoted to `base.css` — they are site components, not page ones.
- `.num-circle`, `.timeline-time`, `.walkaway-*` exist on BOTH pages with
  **different values**. They stay per-page on purpose: huddle's are scoped by
  Astro, compensation's are `is:global` but land in their own page bundle, so
  neither can reach the other. Verified in `dist/`. Do not "de-duplicate" these
  without reconciling the values first.
- `/compensation` styles are `is:global` rather than scoped because the live
  counter script writes to elements by id and toggles classes at runtime; scoped
  CSS would not match what the script adds.

### Known gap

`public/compensation-og.png` is a stopgap generated by `scripts/make-og-image.mjs`
(logo on the brand background). The page had pointed `og:image` at a file that
existed nowhere, so shares rendered with no preview. A purpose-made card would
be better.

### Route shadowing — handled by the build, do not undo

`scripts/fix-directory-shadowing.mjs` runs after every build and writes
`<name>/index.html` next to `<name>.html` wherever a directory of the same name
exists. /club hit this structurally — it needs both the index and five child
pages — and Cloudflare Pages resolves the directory first, so /club 404'd on the
deployment while every city page worked. `astro preview` serves it fine, so this
only ever shows up once deployed.

The original instance:

`build.format: 'file'` emits `dist/compensation.html`. Putting assets in
`public/compensation/` also created `dist/compensation/`, and **Cloudflare Pages
resolves the directory before the file**, so `/compensation` returned 404 while
`/compensation/og.png` worked. `astro preview` does NOT reproduce this — it
served the page fine locally.

The assets are therefore `public/compensation-og.png` and
`public/compensation-logo.svg`: still matched by a `/compensation*` prefix rule,
but no directory to shadow the page. Never create a `public/<name>/` directory
with the same name as a page.

## Phase 4 — in progress

Done: the 5 club city pages (`src/pages/club/[slug].astro` + `src/content/clubs/*.md`).

Migrated: the 5 club city pages, the 6 partner pages, `/about`, `/benefits`,
`/group`, `/product-talks`. 19 pages build; all verified 200 on the deployment.

### Forms are live

`RESEND_API_KEY` is set on `impostorpm-site` (production). All three forms
verified end to end — `/partner-with-us` and both booking forms return
`{"status":"ok"}` and deliver.

**A secret only binds on a NEW deployment.** After `wrangler pages secret put`,
the running deployment keeps returning 503 until you redeploy. That is not a
misconfiguration and cost a round of debugging here.

**Nothing left on Softr.** Every page in the sitemap is either migrated or
intentionally redirected. Softr can be cancelled once the routing cutover
(Phase 5) is done and the soak period passes.

`/mentalhealth` is a 301 to `/product-talks` rather than a page: on Softr it is
already a duplicate of Product Talks, and its own `<title>` reads "Mental Health
Series is now: Product Talks".

`/benefits` is generated from the partners collection, so a new perk is one .md
file and it appears on its own page, on /benefits, and nowhere else needs editing.

### Bugs found on the live Softr site while extracting

1. **`/club/braga` renders Hamburg's content.** URL and `<title>` say Braga, but
   the hero reads "Hamburg has a Club waiting for you!" and the waitlist says
   "Join the Hamburg waiting list". `og:title` says *Porto*. Only the past-Clubs
   list is actually Braga's. Reproduced twice with a render-stability wait, so
   it is not a capture artifact. Fixed by the migration.
2. **`/club/porto` and `/club/coimbra` advertise expired events as upcoming** —
   25 and 30 June, still shown as the next Club on 31 July, because the block is
   fed by a table nobody prunes. Reading the Luma calendar means an event stops
   being upcoming on its own.
3. `/compensation`'s `og:image` pointed at a file that never existed (Phase 2).
4. The `/huddle` nav linked to `/boost-2nd`, a 404 (Phase 1).

### Softr rate-limits automated extraction

Roughly a dozen rapid page loads in a row got the connection closed
(`ERR_CONNECTION_CLOSED`) for about a minute. Pace the remaining extraction:
one page per navigation, 8s render wait, and do not batch more than two.

### Partner pages

Six migrated. Two of them (`tekya`, `builderscamp`) ship **without an About
section on purpose**:

- `/tekya` on Softr has Lorem ipsum as its About copy, and `og:description` is
  literally "Ipsum Lorem".
- `/builderscamp` never renders its content at all — the page loads the nav and
  stops at "Loading…" (465 characters total). Two attempts, 8s and 10s waits.

Copying either across would migrate the defect rather than the page. The
template hides the About heading when the body is empty, so writing the copy
into the `.md` file is all that is needed.

**`og:description` is "Ipsum Lorem" on every partner page on Softr**, including
the ones with real content. The migrated pages have proper descriptions.

Also stale on Softr: `/productized` still describes the "Productized Conference
**2024**".

## Illustrations

The first pass migrated text only, which left the pages reading flat next to the
homepage and /compensation — the Softr illustrations are doing layout work, not
decorating.

- `scripts/fetch-page-illustrations.mjs` pulls them by `name|url` so files land
  as `club-hero.webp`, not a UUID. 20 assets, **36 MB → 2.2 MB**. SVG stays
  vector.
- Event cards now render Luma's `cover_url`. That was already in the API
  response and simply not used — it gives /events, /club/*, /product-talks and
  the homepage real photography that stays current on its own, with no asset to
  maintain. Fixed intrinsic size so lazy loading cannot shift the layout.

Two sections were missing from the first pass and are now in: **"Do you want to
contact us?"** on /about, and the **sponsors strip** on /boost.

### Finding the assets: DOM scraping was the wrong tool

The first image pass walked the rendered DOM for `<img>` elements and missed
roughly two thirds of them, because Softr uses `background-image` for hero
photos and for the whole city grid, and because anything below the fold had not
lazy-loaded yet when the page was read.

**Read the asset URLs out of the HTML shell instead.** Softr embeds them in the
page config, so a plain `curl` finds every asset on a page — backgrounds, below
the fold, all of it — with no browser and no scrolling:

```
curl -sL -A "<browser UA>" https://www.impostor.pm/<page> \
  | grep -oE 'https://(assets\.softr-files\.com/applications/[^"'"'"']+|i\.postimg\.cc/[^"'"'"']+)'
```

That turned 27 assets into **61**. All are archived in
`content-source/raw-assets/` — deliberately outside `public/`, so unused ones
are kept for reference without shipping in the deploy.

Note some assets are on **postimg.cc**, not Softr — the city illustrations
among them. Those survive cancelling Softr, but they are now self-hosted anyway.

### What /club actually needed

The text-only version was missing a full-bleed hero photo, a dark "We are 100%
free" band, the Senja testimonials (same widget id as the homepage), and the
city grid with its per-city landmark line drawings. All in.

Per-city and per-partner **social cards** were also found and wired to
`seo.ogImage`, and the partner cards double as the hero banner on their page.

Still text-only, correctly: `/benefits` carries no illustrations on Softr either,
`/tekya` has no images at all, and /compensation has its own art already.

## Before cancelling Softr

Run `npm run validate` first. It asserts, among other things, that nothing on the
site still loads from a host that disappears with the subscription — which was a
live problem until 2026-08-03, when `/salary-compass/` was still pulling its font,
icons and favicon from Softr's CDN.

### The Airtable export is NOT a blocker — decided 2026-08-03

Earlier drafts of the plan listed "export the Softr/Airtable table" as a gate.
That was written before the content was migrated and is no longer true. Verified:
the site has **zero** runtime dependency on Airtable. The only mentions left in
the repo are comments recording that the content used to live there. All five
clubs use `source: luma`, none use `manualItems`, and the four Product Talks are
markdown in `src/content/talks/`.

What the table would hold that nothing else does:

- Club events earlier than **2025-11-20**, which is the oldest event Luma has
  (16 past events, covering all five cities).
- Product Talks beyond the four transcribed from the card artwork.
- Any sign-up or waiting-list rows.

None of it affects whether the site works. Javi's call: not exporting now, and
possibly exporting later purely to lengthen the event history. Do not re-raise
this as a blocker.

### What is still genuinely open

- **Google Maps API key.** Seen in Softr's page source, never in this repo, and
  not recoverable now that Softr no longer serves the domain. It is quite likely
  Softr's own key rather than Javi's — Softr embeds one for its map blocks. Worth
  one look in Google Cloud → Credentials; if no Maps key exists there, it was
  theirs and there is nothing to do. Either way the exposure has already ended:
  no page on impostor.pm serves a key, and impostor.softr.app 301s.
- The two-week quiet period, then: merge to `main`, retire `salary-compass-pages`
  / `impostorpm-rezonant` / `impostorpm-huddle`, and swap the proxy Worker for a
  real Pages custom domain.
