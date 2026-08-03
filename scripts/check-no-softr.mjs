#!/usr/bin/env node
/**
 * Build gate: fail if anything still points at a Softr-hosted asset.
 *
 * These references resolve fine today, which is exactly the danger — they keep
 * working right up until the Softr subscription is cancelled, and then the
 * fonts, icons and images disappear from a site that has otherwise been fully
 * migrated for weeks. A grep is cheaper than that outage.
 *
 * `public/salary-compass/` and `public/rezonant/` are the two legacy pages that
 * ship byte-for-byte; they are listed as known offenders rather than ignored, so
 * the count has to go DOWN and can never silently go up.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not URL.pathname: the repo lives under a directory with a
// space in its name, and .pathname hands back "JAVI%20WORKSPACE", which stat()
// then fails to find — making this gate silently scan nothing and always pass.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN = ['src', 'public', 'functions'];
const SKIP = new Set(['node_modules', '.git', 'dist', '.astro']);
const BINARY = /\.(png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot|pdf|mp4|zip)$/i;

// Match actual URLs, not prose. The comments explaining *why* these hosts are
// forbidden necessarily name them, and a bare-substring match flags those too —
// which trains you to delete the explanation instead of the dependency.
const PATTERNS = [
  { re: /https?:\/\/[^\s"'()<>]*softr-files\.com/g, what: 'Softr-hosted asset' },
  { re: /https?:\/\/impostorpm-huddle\.pages\.dev/g, what: 'stale Pages project' },
];

// Files still allowed to contain hits, with the exact count expected today.
// Lower these as the pages get cleaned up; never raise them.
const ALLOWED = new Map([
  // Reached zero on 2026-08-03. Was 11: Inter and Font Awesome were loaded from
  // Softr's CDN and the favicon was hotlinked to it, so the highest-value page on
  // the site would have lost its font, its icons and its favicon the day the
  // subscription was cancelled. Inter now comes from Google Fonts, the ten icons
  // it uses are generated into salary-compass/icons.css by
  // scripts/build-icon-css.mjs, and the favicon is the site's own.
  ['public/salary-compass/index.html', 0],
  // rezonant reached zero in Phase 1: favicon self-hosted, Inter moved to
  // Google Fonts, JSON-LD logo repointed. Kept at 0 so it cannot regress.
  ['public/rezonant/index.html', 0],
]);

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (!BINARY.test(entry.name)) yield full;
  }
}

const offenders = [];
const seen = new Map();

for (const dir of SCAN) {
  const abs = join(ROOT, dir);
  try {
    await stat(abs);
  } catch {
    continue;
  }
  for await (const file of walk(abs)) {
    const rel = relative(ROOT, file);
    const text = await readFile(file, 'utf8');
    let count = 0;
    const kinds = new Set();
    for (const { re, what } of PATTERNS) {
      const hits = text.match(re);
      if (hits) {
        count += hits.length;
        kinds.add(what);
      }
    }
    if (count) {
      seen.set(rel, count);
      const budget = ALLOWED.get(rel) ?? 0;
      if (count > budget) {
        offenders.push({ rel, count, budget, kinds: [...kinds].join(', ') });
      }
    }
  }
}

// A budget that is no longer needed means the file got cleaned: tighten it.
const stale = [...ALLOWED.keys()].filter((f) => (seen.get(f) ?? 0) < (ALLOWED.get(f) ?? 0));

if (offenders.length || stale.length) {
  for (const o of offenders) {
    console.error(`✗ ${o.rel}: ${o.count} reference(s) to ${o.kinds} (allowed: ${o.budget})`);
  }
  for (const f of stale) {
    console.error(`✗ ${f}: now has ${seen.get(f) ?? 0} hits but ALLOWED says ${ALLOWED.get(f)} — lower it in scripts/check-no-softr.mjs`);
  }
  process.exit(1);
}

const remaining = [...seen.values()].reduce((a, b) => a + b, 0);
console.log(`✓ no unexpected Softr references (${remaining} remaining in known legacy pages)`);
