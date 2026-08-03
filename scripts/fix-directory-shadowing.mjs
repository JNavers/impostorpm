#!/usr/bin/env node
/**
 * Emit `<name>/index.html` alongside `<name>.html` wherever a directory of the
 * same name exists.
 *
 * `build.format: 'file'` writes dist/club.html, and the city pages write
 * dist/club/. Cloudflare Pages resolves the DIRECTORY first, so /club would
 * 404 even though the file is right there. `astro preview` does not reproduce
 * it — it serves the file quite happily — so this only shows up once deployed.
 *
 * We keep `format: 'file'` because it is what preserves the slash-less URLs
 * Softr serves and Google has indexed. Writing both copies costs a few KB and
 * removes a whole class of "this route is fine locally" surprises: any future
 * page that gains children is covered automatically.
 *
 * Run after `astro build`.
 */
import { readdir, copyFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(fileURLToPath(new URL('..', import.meta.url)), 'dist');

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  let fixed = 0;

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      fixed += await walk(full);
      continue;
    }
    if (!entry.name.endsWith('.html')) continue;

    const base = entry.name.slice(0, -'.html'.length);
    const twin = join(dir, base);
    if (await isDirectory(twin)) {
      await copyFile(full, join(twin, 'index.html'));
      console.log(`  ✓ ${base}/index.html  (directory would have shadowed ${base}.html)`);
      fixed += 1;
    }
  }
  return fixed;
}

const count = await walk(DIST);
console.log(count ? `${count} shadowed route(s) fixed` : 'no shadowed routes');
