#!/usr/bin/env node
/**
 * Pushes the Salary Compass environment into Cloudflare Pages as SECRETS.
 *
 * Reads db/.env.cloudflare (git-ignored) and pipes each value into
 * `wrangler pages secret put`, so no secret is ever passed as an argument —
 * argv is visible to anything that can read the process table, and ends up in
 * shell history.
 *
 * Secrets rather than plain text vars, deliberately: a Text variable can be
 * read back from the dashboard and shows up in build logs. The service_role
 * key bypasses every RLS policy, so whoever holds it can read and write any
 * row in the database.
 *
 * Both environments, because Cloudflare keeps Production and Preview separate
 * and a preview deploy with no database returns 500 from every endpoint —
 * which is exactly where this gets verified before anything goes live.
 *
 *   node scripts/push-cloudflare-env.mjs [--preview-only|--production-only]
 */

import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = join(HERE, '..', '.env.cloudflare');
const PROJECT = 'impostorpm-site';

const argv = new Set(process.argv.slice(2));
const envs = argv.has('--preview-only') ? ['preview']
  : argv.has('--production-only') ? ['production']
    : ['production', 'preview'];

function run(args, stdin) {
  return new Promise((resolve) => {
    const child = spawn('npx', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

const raw = await readFile(ENV_FILE, 'utf8');
const vars = Object.fromEntries(
  raw.split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

console.log(`Pushing ${Object.keys(vars).length} secrets to ${PROJECT}: ${Object.keys(vars).join(', ')}\n`);

let failed = 0;
for (const env of envs) {
  console.log(`── ${env} ──`);
  for (const [name, value] of Object.entries(vars)) {
    const { code, out } = await run(
      ['wrangler', 'pages', 'secret', 'put', name, '--project-name', PROJECT, '--env', env],
      value
    );
    if (code === 0) {
      console.log(`  ✔ ${name}`);
    } else {
      failed++;
      // The value is never echoed, only wrangler's own diagnosis.
      const reason = out.split('\n').find((l) => /error|✘/i.test(l)) || `exit ${code}`;
      console.log(`  ✖ ${name}: ${reason.trim().slice(0, 160)}`);
    }
  }
}

console.log(failed ? `\n${failed} failed.\n` : '\nAll set.\n');
process.exit(failed ? 1 : 0);
