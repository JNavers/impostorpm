#!/usr/bin/env node
/**
 * Download every Softr-hosted image referenced by an HTML file, re-encode it,
 * and rewrite the references to local paths.
 *
 * These images work fine today, which is the trap: they keep working right up
 * until the Softr subscription is cancelled and then the homepage loses its
 * community gallery and every partner logo at once.
 *
 * Re-encoding is not cosmetic. The originals are full-resolution uploads — the
 * gallery strip renders them at 200px tall and the partner logos at ~40px, so
 * the page currently ships several MB to display a few hundred KB worth of
 * pixels.
 *
 *   node scripts/rehost-softr-assets.mjs <source.html> <out-dir> <public-prefix>
 *
 * Writes content-source/asset-map.json so anything missed later can be traced
 * back to the URL it came from.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const [sourceArg, outArg, prefixArg] = process.argv.slice(2);

if (!sourceArg || !outArg || !prefixArg) {
  console.error('usage: rehost-softr-assets.mjs <source.html> <out-dir> <public-prefix>');
  process.exit(1);
}

const sourcePath = join(ROOT, sourceArg);
const outDir = join(ROOT, outArg);
const html = await readFile(sourcePath, 'utf8');

const urls = [...new Set(html.match(/https:\/\/[a-z0-9.-]*softr-files\.com[^"')\s]+/g) ?? [])];
if (!urls.length) {
  console.log('no Softr assets referenced — nothing to do');
  process.exit(0);
}

await mkdir(outDir, { recursive: true });
await mkdir(join(ROOT, 'content-source'), { recursive: true });

/** Widest the asset is ever displayed at, times two for retina. */
const MAX_WIDTH = 900;

const map = {};
let rewritten = html;
let savedBytes = 0;

for (const [index, url] of urls.entries()) {
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`  ✗ ${response.status}  ${url}`);
    continue;
  }
  const contentType = response.headers.get('content-type') ?? '';
  const original = Buffer.from(await response.arrayBuffer());

  // Not every softr-files.com URL in the page is an image: the Font Awesome and
  // Inter stylesheets are on the same host. Those are <link> hrefs handled by
  // the layout (self-hosted icons, Google Fonts), so rewriting them to a local
  // image path would be wrong — leave them for the build gate to flag.
  if (contentType.includes('text/css') || contentType.includes('javascript')) {
    console.log(`  – skipped (${contentType.split(';')[0]})  ${url.split('/').pop()}`);
    continue;
  }

  // SVG stays vector. Rasterising a logo to WebP throws away the one property
  // that makes it worth having.
  if (contentType.includes('svg')) {
    const name = `${String(index + 1).padStart(2, '0')}-${url.split('/').pop()?.split('.')[0]?.slice(0, 8)}.svg`;
    await writeFile(join(outDir, name), original);
    const publicPath = `${prefixArg.replace(/\/$/, '')}/${name}`;
    rewritten = rewritten.replaceAll(url, publicPath);
    map[url] = publicPath;
    console.log(`  ✓ ${name.padEnd(24)} vector   ${(original.length / 1024).toFixed(0).padStart(5)} KB (verbatim)`);
    continue;
  }

  const image = sharp(original);
  let meta;
  try {
    meta = await image.metadata();
  } catch (error) {
    console.error(`  ✗ unreadable (${contentType})  ${url.split('/').pop()}`);
    continue;
  }
  const hasAlpha = meta.hasAlpha ?? false;

  // WebP for everything: it handles both the photographic gallery shots and the
  // flat partner logos, and every browser that can run this site supports it.
  const encoded = await image
    .resize({ width: Math.min(meta.width ?? MAX_WIDTH, MAX_WIDTH), withoutEnlargement: true })
    .webp({ quality: hasAlpha ? 90 : 82, effort: 6 })
    .toBuffer();

  const name = `${String(index + 1).padStart(2, '0')}-${url.split('/').pop()?.split('.')[0]?.slice(0, 8)}.webp`;
  await writeFile(join(outDir, name), encoded);

  const publicPath = `${prefixArg.replace(/\/$/, '')}/${name}`;
  rewritten = rewritten.replaceAll(url, publicPath);
  map[url] = publicPath;
  savedBytes += original.length - encoded.length;

  console.log(
    `  ✓ ${name.padEnd(24)} ${String(meta.width ?? '?').padStart(5)}px  ` +
      `${(original.length / 1024).toFixed(0).padStart(5)} KB → ${(encoded.length / 1024).toFixed(0).padStart(4)} KB`
  );
}

await writeFile(sourcePath, rewritten);
await writeFile(
  join(ROOT, 'content-source/asset-map.json'),
  JSON.stringify(map, null, 2) + '\n'
);

console.log(
  `\n${Object.keys(map).length} assets rehosted, ${(savedBytes / 1024 / 1024).toFixed(2)} MB saved`
);
console.log(`references rewritten in ${sourceArg}; map in content-source/asset-map.json`);
