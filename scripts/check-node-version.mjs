#!/usr/bin/env node
/**
 * Fails the build if .node-version is below what Astro actually requires.
 *
 * This exists because pinning it wrong is silent: `.node-version` was set to a
 * bare "22" while Astro 7 needs >=22.12.0, the local machine happened to run 24
 * so every local build passed, and only the Cloudflare build failed — after the
 * project had been connected to git. The commit meant to make builds
 * deterministic is the one that broke them.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const pinned = read('.node-version').trim();
const required = JSON.parse(read('node_modules/astro/package.json')).engines.node;
const declared = JSON.parse(read('package.json')).engines.node;

/** Bare "22" is the trap: it satisfies no floor above 22.0.0. */
const parts = pinned.split('.').map(Number);
if (parts.length < 3 || parts.some(Number.isNaN)) {
  console.error(`✗ .node-version is "${pinned}" — pin a full x.y.z, not a bare major.`);
  console.error(`  Astro requires ${required}.`);
  process.exit(1);
}

const floor = (required.match(/(\d+)\.(\d+)\.(\d+)/) ?? []).slice(1).map(Number);
const below = parts.some((n, i) => (n === floor[i] ? false : n < floor[i]) && parts.slice(0, i).every((m, j) => m === floor[j]));
if (below) {
  console.error(`✗ .node-version ${pinned} is below Astro's ${required}.`);
  process.exit(1);
}
if (!declared.includes(floor.join('.'))) {
  console.error(`✗ package.json engines says "${declared}" but Astro requires ${required}.`);
  process.exit(1);
}
console.log(`✓ Node ${pinned} satisfies Astro ${required}`);
