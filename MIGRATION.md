# Migration status

Moving impostor.pm off Softr. Full plan:
`~/Documents/JAVI WORKSPACE/.claude/plans/quiero-migrar-mi-web-validated-horizon.md`

## What serves what, right now

| Path | Origin |
|---|---|
| `/salary-compass*` | Cloudflare Pages `salary-compass-pages` (repo `JNavers/salary-compass`) |
| `/rezonant*` | Cloudflare Pages `impostorpm-rezonant` (this repo, **`main` only**) |
| `/api/*` | **Softr** — not covered by any rule. This is why the Salary Compass email capture 405s. |
| everything else | Softr (`impostor.softr.app`, `3.64.247.100`) |

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
