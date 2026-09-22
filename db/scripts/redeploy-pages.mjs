#!/usr/bin/env node
/**
 * Re-runs the latest Pages deployment so it picks up secrets set after it built.
 *
 * Pages injects environment variables at BUILD time, so a secret added after a
 * deployment finished is invisible to it — the endpoint keeps rejecting a
 * perfectly correct value with a bare 401 that looks like a wrong secret and is
 * not one. Setting a secret is therefore only half the job; this is the other
 * half.
 *
 * Uses wrangler's own OAuth token. There is no wrangler command for this, only
 * the dashboard's "Retry deployment" button and this API call.
 *
 *   node scripts/redeploy-pages.mjs [production|preview]
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ACCOUNT = '55bcddf1dd900be1d4788d96575e0e00';
const PROJECT = 'impostorpm-site';
const ENV = process.argv[2] || 'production';
const API = 'https://api.cloudflare.com/client/v4';

async function token() {
  // Wrangler has used two config locations over time and leaves the stale one
  // in place; pick whichever token has not expired.
  const candidates = [
    join(homedir(), '.wrangler', 'config', 'default.toml'),
    join(homedir(), 'Library', 'Preferences', '.wrangler', 'config', 'default.toml')
  ];
  const found = [];
  for (const path of candidates) {
    try {
      const text = await readFile(path, 'utf8');
      const tok = text.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
      const exp = text.match(/^expiration_time\s*=\s*"([^"]+)"/m)?.[1];
      if (tok) found.push({ tok, expires: exp ? new Date(exp) : null });
    } catch { /* not present */ }
  }
  const live = found.filter((f) => !f.expires || f.expires > new Date());
  if (!live.length) throw new Error('No live wrangler token. Run: npx wrangler login');
  return live.sort((a, b) => (b.expires ?? 0) - (a.expires ?? 0))[0].tok;
}

const tok = await token();
const headers = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };

const list = await fetch(
  `${API}/accounts/${ACCOUNT}/pages/projects/${PROJECT}/deployments?env=${ENV}`,
  { headers }
).then((r) => r.json());

if (!list.success || !list.result?.length) {
  console.error(`Could not list ${ENV} deployments: ${JSON.stringify(list.errors || list).slice(0, 200)}`);
  process.exit(1);
}

const latest = list.result[0];
console.log(`Latest ${ENV}: ${latest.id}`);
console.log(`  ${latest.deployment_trigger?.metadata?.commit_hash?.slice(0, 7) || '?'} — ${latest.created_on}`);

const retry = await fetch(
  `${API}/accounts/${ACCOUNT}/pages/projects/${PROJECT}/deployments/${latest.id}/retry`,
  { method: 'POST', headers }
).then((r) => r.json());

if (!retry.success) {
  console.error(`Retry failed: ${JSON.stringify(retry.errors || retry).slice(0, 300)}`);
  process.exit(1);
}

console.log(`\n✔ Re-deploying as ${retry.result.id}`);
console.log(`  ${retry.result.url}`);
console.log('\nSecrets are read at build time, so wait for this to finish before testing them.\n');
