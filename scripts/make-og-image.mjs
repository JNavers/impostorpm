/**
 * Build the /compensation OG card.
 *
 * The page has always pointed og:image at /compensation/og.png, and that file
 * exists nowhere — not in either repo, not on salary-compass-pages. The 200 in
 * production is Softr's HTML 404 page, so every share of this page has rendered
 * without a preview image.
 *
 * Composited from assets already in the repo rather than designed: the brand
 * near-black, the golden rule, and the existing horizontal logo. A purpose-made
 * card would be better, but a correct 1200x630 beats a missing file.
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const W = 1200;
const H = 630;

const NEAR_BLACK = '#1e1e1e';
const GOLDEN = '#ffc600';

const logo = await sharp(`${REPO}/public/brand/tipm-logo-horizontal-white.png`)
  .resize({ width: 520, fit: 'inside' })
  .toBuffer();
const logoMeta = await sharp(logo).metadata();

// Golden rule under the logo, plus a full-width bottom band.
const overlay = Buffer.from(`
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="${H - 14}" width="${W}" height="14" fill="${GOLDEN}"/>
  <rect x="${(W - 120) / 2}" y="${H / 2 + 46}" width="120" height="6" rx="3" fill="${GOLDEN}"/>
  <circle cx="${W - 90}" cy="90" r="52" fill="${GOLDEN}" opacity="0.18"/>
</svg>`);

await sharp({
  create: { width: W, height: H, channels: 4, background: NEAR_BLACK },
})
  .composite([
    { input: overlay, top: 0, left: 0 },
    {
      input: logo,
      top: Math.round(H / 2 - (logoMeta.height ?? 0) / 2 - 20),
      left: Math.round((W - (logoMeta.width ?? 0)) / 2),
    },
  ])
  .png({ compressionLevel: 9 })
  .toFile(`${REPO}/public/compensation-og.png`);

const out = await sharp(`${REPO}/public/compensation-og.png`).metadata();
console.log(`og.png  ${out.width}x${out.height}  ${out.size} bytes`);
