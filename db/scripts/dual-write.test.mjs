/**
 * compass-dual-write.js — the browser side of migration step 3.
 *
 * This runs on the live page while the old backend is still authoritative, so
 * the property that matters most is not that it works: it is that when it
 * DOESN'T work, nobody notices. Most of these tests are about failure.
 *
 * The file is a plain IIFE meant for a browser, so it is loaded into a
 * hand-rolled window rather than imported.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SOURCE = join(
  dirname(fileURLToPath(import.meta.url)), '..', '..',
  'public', 'salary-compass', 'compass-dual-write.js'
);

/**
 * Loads the script with a fake browser around it.
 *
 * @param {object} opts
 *   hostname   - which host the page thinks it is on
 *   turnstile  - 'ok' | 'error' | 'timeout' | 'script-fails'
 *   fetchImpl  - custom fetch, defaults to recording calls and returning 201
 */
async function load(opts = {}) {
  const calls = { fetch: [], events: [] };
  const hostname = opts.hostname || 'www.impostor.pm';

  const fetchImpl = opts.fetchImpl || (async (url, init) => {
    calls.fetch.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : null });
    const id = '11111111-2222-4333-8444-555555555555';
    return {
      ok: true, status: 201,
      text: async () => JSON.stringify({ status: 'ok', id, token: 'tok' })
    };
  });

  const scripts = [];
  const window = {
    location: { hostname },
    performance: { now: () => 0 },
    posthog: { capture: (event, props) => calls.events.push({ event, props }) },
    setTimeout, clearTimeout, Promise, Error, JSON, encodeURIComponent, Object
  };

  const document = {
    head: { appendChild: (el) => { scripts.push(el); if (opts.turnstile === 'script-fails') { setImmediate(() => el.onerror?.()); } else { setImmediate(() => { window.turnstile = makeTurnstile(opts.turnstile); el.onload?.(); }); } } },
    body: { appendChild: () => {} },
    createElement: () => ({ style: {}, set onload(fn) { this._onload = fn; }, get onload() { return this._onload; }, set onerror(fn) { this._onerror = fn; }, get onerror() { return this._onerror; } })
  };

  function makeTurnstile(mode) {
    return {
      render: () => 'widget-1',
      reset: () => {},
      execute: (_id, cb) => {
        if (mode === 'error') return setImmediate(() => cb['error-callback']());
        if (mode === 'timeout') return; // never calls back
        setImmediate(() => cb.callback('turnstile-token-abc'));
      }
    };
  }

  const ctx = vm.createContext({
    window, document, fetch: fetchImpl, setTimeout, clearTimeout,
    console: { log() {}, info() {}, warn() {}, error() {} }
  });
  ctx.globalThis = ctx;
  // The IIFE assigns onto `window`; in a browser that is also the global.
  Object.setPrototypeOf(ctx, new Proxy({}, {
    get: (_t, k) => window[k],
    has: (_t, k) => k in window
  }));

  vm.runInContext(await readFile(SOURCE, 'utf8'), ctx);
  return { api: window.compassDualWrite, calls, window };
}

const CREATE = {
  action: 'create', id: 'client-uuid-1', baseSalary: 62000, totalComp: 70000,
  role: 'Senior PM', yoe: 7, city: 'Porto', perceptionGuess: 55
};

test('it mirrors a comparison to POST /submissions', async () => {
  const { api, calls } = await load();
  await api.mirror(CREATE);

  const post = calls.fetch.find((c) => c.url.endsWith('/submissions'));
  assert.ok(post, `no POST to /submissions (got ${calls.fetch.map((c) => c.url).join(', ')})`);
  assert.equal(post.method, 'POST');
  assert.equal(post.body.baseSalary, 62000);
  assert.equal(post.body.city, 'Porto');
  assert.equal(post.body.turnstileToken, 'turnstile-token-abc');
});

test('the survey reaches the row the comparison created', async () => {
  // The new backend assigns its own uuid while the Sheet keys off a
  // client-generated one, and the survey arrives minutes later.
  const { api, calls } = await load();
  await api.mirror(CREATE);
  await api.mirror({ action: 'update', id: 'client-uuid-1', gender: 'Female', industry: 'SaaS' });

  const patch = calls.fetch.find((c) => c.method === 'PATCH');
  assert.ok(patch, 'no PATCH was sent');
  assert.match(patch.url, /\/submissions\/11111111-2222-4333-8444-555555555555$/);
  assert.equal(patch.body.gender, 'Female');
});

test('the survey PATCH carries no routing fields', async () => {
  const { api, calls } = await load();
  await api.mirror(CREATE);
  await api.mirror({
    action: 'update', id: 'client-uuid-1', dashboardToken: 'tok', email: 'a@b.com',
    resend_via: 'email_api', gender: 'Male'
  });

  const patch = calls.fetch.find((c) => c.method === 'PATCH');
  assert.deepEqual(Object.keys(patch.body), ['gender'],
    'action/id/dashboardToken/email must not be forwarded as survey answers');
});

test('a survey with no mirrored comparison is dropped, not invented', async () => {
  // Making up a submission here would put a survey in the dataset with no
  // salary attached to it, which is worse than losing the survey.
  const { api, calls } = await load();
  const result = await api.mirror({ action: 'update', id: 'never-created', gender: 'Female' });

  assert.equal(result, null);
  assert.equal(calls.fetch.filter((c) => c.method === 'PATCH').length, 0);
  const failure = calls.events.find((e) => e.event === 'compass_mirror_failed');
  assert.equal(failure.props.reason, 'no-mirrored-submission');
  assert.equal(failure.props.expected, true, 'and it is recorded as expected, not as a bug');
});

test('an email capture becomes POST /contacts, linked to the submission', async () => {
  const { api, calls } = await load();
  await api.mirror(CREATE);
  await api.mirror({
    action: 'email_only', submission_id: 'client-uuid-1', email: 'a@example.com',
    source: 'email_gate', newsletter_optin: 'true', percentile: 42
  });

  const post = calls.fetch.find((c) => c.url.endsWith('/contacts'));
  assert.equal(post.body.email, 'a@example.com');
  assert.equal(post.body.submission_id, '11111111-2222-4333-8444-555555555555');
  assert.equal(post.body.newsletter_optin, true, "the Sheet sends 'true' as a string");
});

// ── Failure is the point ──

test('a backend error never rejects', async () => {
  const { api, calls } = await load({
    fetchImpl: async () => ({ ok: false, status: 500, text: async () => '{"status":"error"}' })
  });

  const result = await api.mirror(CREATE);
  assert.equal(result, null, 'an unhandled rejection in the page is what this prevents');
  const failure = calls.events.find((e) => e.event === 'compass_mirror_failed');
  assert.equal(failure.props.status, 500, 'but the failure is measured');
});

test('a network failure never rejects', async () => {
  const { api } = await load({ fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(await api.mirror(CREATE), null);
});

test('a Turnstile failure never rejects and sends nothing', async () => {
  const { api, calls } = await load({ turnstile: 'error' });
  assert.equal(await api.mirror(CREATE), null);
  assert.equal(calls.fetch.length, 0, 'no write without a token');
});

test('a Turnstile script that fails to load never rejects', async () => {
  const { api, calls } = await load({ turnstile: 'script-fails' });
  assert.equal(await api.mirror(CREATE), null);
  assert.equal(calls.fetch.length, 0);
});

test('preview hosts are allowed, since the widget now covers them', async () => {
  // <hash>.impostorpm-site.pages.dev. Turnstile matches subdomains of a
  // registered domain, so the mirror can be exercised on a preview instead of
  // having its first real run in production.
  const { api, calls } = await load({ hostname: '2c4f49fa.impostorpm-site.pages.dev' });
  assert.equal(api.enabled, true);
  await api.mirror(CREATE);
  assert.equal(calls.fetch.length, 1);
});

test('the apex and www are allowed', async () => {
  for (const hostname of ['impostor.pm', 'www.impostor.pm', 'impostorpm-site.pages.dev']) {
    const { api } = await load({ hostname });
    assert.equal(api.enabled, true, `${hostname} should be allowed`);
  }
});

test('a lookalike domain is NOT allowed', async () => {
  // The check is a suffix match, so it needs the leading dot or
  // "notimpostor.pm" would pass as a subdomain of "impostor.pm".
  for (const hostname of ['notimpostor.pm', 'impostor.pm.evil.com', 'localhost',
    'evil-impostorpm-site.pages.dev']) {
    const { api, calls } = await load({ hostname });
    assert.equal(api.enabled, false, `${hostname} must NOT be allowed`);
    await api.mirror(CREATE);
    assert.equal(calls.fetch.length, 0);
  }
});

test('an unknown action is ignored', async () => {
  const { api, calls } = await load();
  assert.equal(await api.mirror({ action: 'delete_everything', id: 'x' }), null);
  assert.equal(calls.fetch.length, 0);
});

test('a payload with no action is ignored', async () => {
  const { api, calls } = await load();
  await api.mirror({});
  await api.mirror(null);
  assert.equal(calls.fetch.length, 0);
});

test('success is recorded too, so the mirror rate is visible', async () => {
  // Dual-write exists to find out whether the new path is reliable. A mirror
  // that only reports failures cannot answer that.
  const { api, calls } = await load();
  await api.mirror(CREATE);
  const ok = calls.events.find((e) => e.event === 'compass_mirror_ok');
  assert.ok(ok);
  assert.equal(ok.props.action, 'create');
});
