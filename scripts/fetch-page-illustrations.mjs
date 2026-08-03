#!/usr/bin/env node
/**
 * Download the hero illustrations and section artwork from the Softr pages and
 * re-encode them under stable, readable names.
 *
 * The text-only versions of these pages read as flat next to the homepage and
 * /compensation, which both keep their art — the illustrations are doing real
 * work in the layout, not decorating it.
 *
 * Takes a `name|url` list so the files land as `club-hero.webp` rather than a
 * UUID, which is what makes them referenceable from a template.
 *
 *   node scripts/fetch-page-illustrations.mjs <list.txt> <out-dir>
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const [listArg, outArg] = process.argv.slice(2);
if (!listArg || !outArg) {
  console.error('usage: fetch-page-illustrations.mjs <list.txt> <out-dir>');
  process.exit(1);
}

const outDir = join(ROOT, outArg);
await mkdir(outDir, { recursive: true });

const entries = (await readFile(listArg, 'utf8'))
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const [name, ...rest] = line.split('|');
    return { name: name.trim(), url: rest.join('|').trim() };
  });

/** Twice the widest rendered size on the page — none exceed ~600 CSS px. */
const MAX_WIDTH = 1200;

let saved = 0;
let failed = 0;

for (const { name, url } of entries) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentType = response.headers.get('content-type') ?? '';
    const original = Buffer.from(await response.arrayBuffer());

    // SVG stays vector — these are flat illustrations, and rasterising them
    // trades away the one property worth having.
    if (contentType.includes('svg')) {
      await writeFile(join(outDir, `${name}.svg`), original);
      console.log(`  ✓ ${name}.svg`.padEnd(30) + `vector  ${(original.length / 1024).toFixed(0)} KB`);
      saved += 1;
      continue;
    }

    const image = sharp(original);
    const meta = await image.metadata();
    const encoded = await image
      .resize({ width: Math.min(meta.width ?? MAX_WIDTH, MAX_WIDTH), withoutEnlargement: true })
      .webp({ quality: meta.hasAlpha ? 90 : 82, effort: 6 })
      .toBuffer();

    await writeFile(join(outDir, `${name}.webp`), encoded);
    console.log(
      `  ✓ ${name}.webp`.padEnd(30) +
        `${String(meta.width).padStart(4)}px  ${(original.length / 1024).toFixed(0).padStart(4)} KB → ${(encoded.length / 1024).toFixed(0).padStart(3)} KB`
    );
    saved += 1;
  } catch (error) {
    console.error(`  ✗ ${name}: ${error.message}`);
    failed += 1;
  }
}

console.log(`\n${saved} saved${failed ? `, ${failed} failed` : ''}`);
if (failed) process.exit(1);
