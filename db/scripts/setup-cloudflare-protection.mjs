#!/usr/bin/env node
/**
 * Sets up the two protections the current backend lacks entirely:
 * a Turnstile widget, and the KV binding the per-IP rate limit needs.
 *
 * Both are done through the Cloudflare API with wrangler's own OAuth token, so
 * nothing new has to be issued and nothing is pasted anywhere. The token is
 * read from wrangler's config and never printed.
 *
 * Reads the Pages project's current deployment_configs and writes back only
 * the kv_namespaces key, having saved the original first. A Pages project's
 * config is what makes the site build; clobbering it to add a rate limiter
 * would be a poor trade.
 *
 *   node scripts/setup-cloudflare-protection.mjs [--dry]
 */

import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ACCOUNT = '55bcddf1dd900be1d4788d96575e0e00';
const PROJECT = 'impostorpm-site';
const KV_NAMESPACE_ID = 'b885768ad5834c28b37a3de35db87ce3';
const KV_BINDING = 'COMPASS_RL';
const DRY = process.argv.includes('--dry');

const API = 'https://api.cloudflare.com/client/v4';

async function token() {
  for (const p of [
    join(homedir(), 'Library', 'Preferences', '.wrangler', 'config', 'default.toml'),
    join(homedir(), '.wrangler', 'config', 'default.toml')
  ]) {
    try {
      const m = (await readFile(p, 'utf8')).match(/^oauth_token\s*=\s*"([^"]+)"/m);
      if (m) return m[1];
    } catch { /* try the next location */ }
  }
  throw new Error('No wrangler OAuth token found. Run: npx wrangler login');
}

async function cf(path, init = {}, tok) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${tok}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok && body.success !== false, status: res.status, body };
}

const tok = await token();

// ── 1. Turnstile ──
console.log('Turnstile');
const existing = await cf(`/accounts/${ACCOUNT}/challenges/widgets`, {}, tok);

if (!existing.ok) {
  console.log(`  ✖ cannot list widgets (HTTP ${existing.status}): ` +
    `${JSON.stringify(existing.body.errors || existing.body).slice(0, 200)}`);
  console.log('    The wrangler OAuth token probably lacks the Turnstile scope.');
  console.log('    Create the widget by hand: dash.cloudflare.com → Turnstile → Add site');
} else {
  const already = (existing.body.result || []).find((w) => (w.domains || []).includes('impostor.pm'));
  if (already) {
    console.log(`  ✔ a widget for impostor.pm already exists`);
    console.log(`    sitekey: ${already.sitekey}`);
  } else if (DRY) {
    console.log('  (dry) would create a managed widget for impostor.pm');
  } else {
    const created = await cf(`/accounts/${ACCOUNT}/challenges/widgets`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'salary-compass',
        // The preview hostnames are wildcards under pages.dev, which Turnstile
        // does not accept, so previews will report "skipped" rather than
        // silently passing. That is the honest failure mode.
        domains: ['impostor.pm', 'www.impostor.pm'],
        mode: 'managed'
      })
    }, tok);
    if (created.ok) {
      console.log('  ✔ widget created');
      console.log(`    sitekey: ${created.body.result.sitekey}`);
      console.log(`    secret:  (written to db/.turnstile-secret, git-ignored)`);
      await writeFile(
        new URL('../.turnstile-secret', import.meta.url),
        `${created.body.result.secret}\n`
      );
    } else {
      console.log(`  ✖ create failed (HTTP ${created.status}): ` +
        `${JSON.stringify(created.body.errors || created.body).slice(0, 250)}`);
    }
  }
}

// ── 2. KV binding ──
console.log('\nKV binding');
const project = await cf(`/accounts/${ACCOUNT}/pages/projects/${PROJECT}`, {}, tok);

if (!project.ok) {
  console.log(`  ✖ cannot read the project (HTTP ${project.status})`);
} else {
  const configs = project.body.result.deployment_configs || {};
  await writeFile(
    new URL('../.pages-config-backup.json', import.meta.url),
    JSON.stringify(configs, null, 2)
  );
  console.log('  saved the current deployment_configs to db/.pages-config-backup.json');

  const bound = (env) => configs[env]?.kv_namespaces?.[KV_BINDING]?.namespace_id === KV_NAMESPACE_ID;
  if (bound('production') && bound('preview')) {
    console.log(`  ✔ ${KV_BINDING} is already bound in both environments`);
  } else if (DRY) {
    console.log(`  (dry) would bind ${KV_BINDING} in production and preview`);
  } else {
    // Only kv_namespaces is sent. Everything else in deployment_configs — build
    // command, output directory, compatibility flags — is left untouched.
    const patch = {
      deployment_configs: {
        production: {
          kv_namespaces: {
            ...(configs.production?.kv_namespaces || {}),
            [KV_BINDING]: { namespace_id: KV_NAMESPACE_ID }
          }
        },
        preview: {
          kv_namespaces: {
            ...(configs.preview?.kv_namespaces || {}),
            [KV_BINDING]: { namespace_id: KV_NAMESPACE_ID }
          }
        }
      }
    };
    const patched = await cf(`/accounts/${ACCOUNT}/pages/projects/${PROJECT}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    }, tok);

    if (patched.ok) {
      const after = patched.body.result.deployment_configs || {};
      const ok = ['production', 'preview'].every(
        (e) => after[e]?.kv_namespaces?.[KV_BINDING]?.namespace_id === KV_NAMESPACE_ID
      );
      console.log(ok ? `  ✔ ${KV_BINDING} bound in both environments`
        : `  ⚠ PATCH succeeded but the binding is not visible; check the dashboard`);

      // The build config is what makes the site deploy at all. Verify it
      // survived rather than trusting that a partial PATCH merged cleanly.
      for (const env of ['production', 'preview']) {
        const before = configs[env] || {};
        const now = after[env] || {};
        for (const key of Object.keys(before)) {
          if (key === 'kv_namespaces') continue;
          if (JSON.stringify(before[key]) !== JSON.stringify(now[key])) {
            console.log(`  ⚠ ${env}.${key} CHANGED — restore from db/.pages-config-backup.json`);
          }
        }
      }
    } else {
      console.log(`  ✖ PATCH failed (HTTP ${patched.status}): ` +
        `${JSON.stringify(patched.body.errors || patched.body).slice(0, 250)}`);
    }
  }
}

console.log('');
