#!/usr/bin/env node
/**
 * Shows, pauses or resumes the compass-cron Worker's schedules.
 *
 *   node scripts/cron-schedules.mjs            # show
 *   node scripts/cron-schedules.mjs pause      # remove every schedule
 *   node scripts/cron-schedules.mjs resume     # restore the three
 *
 * Pausing keeps the Worker deployed and does not touch its code or secret; it
 * only stops it waking up. Paused on 2026-09-22 because during dual-write the
 * Apps Script time triggers are still live and send the same result and
 * reminder emails — both running would mail every person twice.
 */

import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ACCOUNT = '55bcddf1dd900be1d4788d96575e0e00';
const SCRIPT = 'compass-cron';
const API = 'https://api.cloudflare.com/client/v4';

/** Must match JOBS in workers/compass-cron/src/worker.js. */
const SCHEDULES = ['*/5 * * * *', '13 * * * *', '43 * * * *'];

async function token({ refreshed = false } = {}) {
  // Wrangler keeps a stale config next to the live one; take the unexpired token.
  // The OAuth token lives about an hour and is only renewed when wrangler itself
  // runs, so if every copy has expired, run a harmless wrangler command once to
  // refresh it and read again.
  const found = [];
  for (const path of [
    join(homedir(), '.wrangler', 'config', 'default.toml'),
    join(homedir(), 'Library', 'Preferences', '.wrangler', 'config', 'default.toml')
  ]) {
    try {
      const t = await readFile(path, 'utf8');
      const tok = t.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
      const exp = t.match(/^expiration_time\s*=\s*"([^"]+)"/m)?.[1];
      if (tok) found.push({ tok, expires: exp ? new Date(exp) : null });
    } catch { /* absent */ }
  }
  const live = found.filter((f) => !f.expires || f.expires > new Date());
  if (!live.length && !refreshed) {
    spawnSync('npx', ['wrangler', 'whoami'], { stdio: 'ignore' });
    return token({ refreshed: true });
  }
  if (!live.length) throw new Error('No live wrangler token. Run: npx wrangler login');
  return live.sort((a, b) => (b.expires ?? 0) - (a.expires ?? 0))[0].tok;
}

const tok = await token();
const url = `${API}/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/schedules`;
const headers = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };

async function show(label) {
  const r = await fetch(url, { headers }).then((x) => x.json());
  if (!r.success) throw new Error(JSON.stringify(r.errors).slice(0, 200));
  const crons = (r.result.schedules || []).map((s) => s.cron);
  console.log(`${label}: ${crons.length ? crons.join(' | ') : '(none — paused)'}`);
  return crons;
}

const action = process.argv[2];
await show('before');

if (action === 'pause' || action === 'resume') {
  const body = action === 'pause' ? [] : SCHEDULES.map((cron) => ({ cron }));
  const r = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) }).then((x) => x.json());
  if (!r.success) throw new Error(JSON.stringify(r.errors).slice(0, 200));
  // Read back rather than trust the write.
  const after = await show('after ');
  const ok = action === 'pause' ? after.length === 0 : SCHEDULES.every((c) => after.includes(c));
  console.log(ok ? `✔ ${action}d` : `✖ ${action} did not take effect`);
  process.exit(ok ? 0 : 1);
}
