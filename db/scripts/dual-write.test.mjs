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
    body: { appendChild: (el) => { window._container = el; } },
    createElement: () => ({ style: {}, set onload(fn) { this._onload = fn; }, get onload() { return this._onload; }, set onerror(fn) { this._onerror = fn; }, get onerror() { return this._onerror; } })
  };

  /**
   * Turnstile, as it actually behaves — which is not what an earlier version of
   * this double assumed, and that cost a broken deploy.
   *
   * The real API delivers the token to the callback passed to RENDER, not to
   * execute(). execute() just starts the challenge and returns nothing. The
   * first double accepted a callback in execute(), so the test suite happily
   * validated code that could never work in a browser: the mock was checking
   * the implementation against itself.
   *
   * It also rejects size:'invisible' (valid: normal, flexible, compact) and
   * needs execution/appearance to defer the challenge, so those are asserted
   * here rather than left to a browser to discover.
   */
  function makeTurnstile(mode) {
    let renderOpts = null;
    let solved = null;
    return {
      render: (_el, opts) => {
        if (opts.size !== undefined && !['normal', 'flexible', 'compact'].includes(opts.size)) {
          throw new Error(`invalid size: ${opts.size}`);
        }
        if (typeof opts.callback !== 'function') {
          throw new Error('render() needs a callback — that is where the token arrives');
        }
        renderOpts = opts;
        // Turnstile can solve the challenge during render, before anything has
        // called execute(). Observed against the live widget: the token was in
        // the DOM while the client sat waiting for a callback that had already
        // fired. Any double that only emits after execute() cannot catch it.
        if (mode === 'solves-on-render') {
          setImmediate(() => { solved = 'token-from-render'; opts.callback(solved); });
        }
        return 'widget-1';
      },
      reset: () => { solved = null; },
      getResponse: () => solved,
      execute: (...args) => {
        if (args.length > 1 && typeof args[1] === 'object' && args[1] !== null) {
          throw new Error('execute() takes no callback options; the real API ignores them');
        }
        if (!renderOpts) throw new Error('execute() before render()');
        if (mode === 'error') return setImmediate(() => renderOpts['error-callback']?.());
        if (mode === 'timeout') return; // never calls back
        // A widget that has already solved does NOT emit again on execute().
        // This is the behaviour that turned a dropped token into a 15-second
        // hang instead of a retry, and a double that re-emits here hides it.
        if (solved) return;
        setImmediate(() => { solved = 'turnstile-token-abc'; renderOpts.callback(solved); });
      },
      /** For assertions about how the widget was configured. */
      _opts: () => renderOpts
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

test('the comparison carries the Sheet id, so a later survey can find it', async () => {
  const { api, calls } = await load();
  await api.mirror(CREATE);
  const post = calls.fetch.find((c) => c.url.endsWith('/submissions'));
  assert.equal(post.body.legacyId, 'client-uuid-1');
});

test('a survey from an email link (no uuid in memory) is sent by Sheet id', async () => {
  // The page that opened the survey never saw the comparison, so it only has
  // the id the link carried. Before this, the survey was dropped here.
  const { api, calls } = await load();
  await api.mirror({ action: 'update', id: 'sheet-id-from-link', gender: 'Female' });

  const patch = calls.fetch.find((c) => c.method === 'PATCH');
  assert.ok(patch, 'no PATCH was sent');
  assert.match(patch.url, /\/submissions\/sheet-id-from-link\?by=legacy$/);
  assert.deepEqual(patch.body, { gender: 'Female' });
});

test('a survey whose comparison never reached the database is dropped, not invented', async () => {
  // Making up a submission here would put a survey in the dataset with no
  // salary attached to it, which is worse than losing the survey.
  const { api, calls } = await load({
    fetchImpl: async (url, init) => {
      calls.fetch.push({ url, method: init?.method });
      return { ok: false, status: 404, text: async () => '{"status":"error","message":"Unknown submission"}' };
    }
  });
  const result = await api.mirror({ action: 'update', id: 'never-created', gender: 'Female' });

  assert.equal(result, null);
  assert.equal(calls.fetch.filter((c) => c.method === 'POST').length, 0, 'nothing is created to hold it');
  const failure = calls.events.find((e) => e.event === 'compass_mirror_failed');
  assert.equal(failure.props.status, 404);
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

test('the widget is configured for deferred execution', async () => {
  // Without execution:'execute' Turnstile runs the challenge at render time,
  // so the token would be spent before the first submission and every mirror
  // after it would fail.
  const { api, window } = await load();
  await api.mirror(CREATE);

  const opts = window.turnstile._opts();
  assert.equal(opts.execution, 'execute');
  assert.equal(opts.appearance, 'execute');
  assert.equal(opts.sitekey, '0x4AAAAAAE_8GTLACwscn7x9');
  assert.equal(opts.size, undefined, "there is no size:'invisible'; leaving it unset is correct");
});

test('the widget container is not hidden', async () => {
  // Turnstile refuses to run inside display:none, and appearance:'execute'
  // already keeps it invisible until a challenge actually needs showing — at
  // which point the visitor has to be able to see and solve it.
  const { api, window } = await load();
  await api.mirror(CREATE);
  assert.notEqual(window._container.style.display, 'none');
});

test('two mirrors get two fresh tokens', async () => {
  // Tokens are single-use and expire in five minutes; the comparison and the
  // survey can be far apart.
  const { api, calls } = await load();
  await api.mirror(CREATE);
  await api.mirror({ action: 'email_only', email: 'a@example.com', source: 'email_gate' });

  const tokens = calls.fetch.map((c) => c.body && c.body.turnstileToken).filter(Boolean);
  assert.equal(tokens.length, 2, 'both writes carried a token');
});

test('a token that arrives before anything waits for it is not lost', async () => {
  // The bug that made the first deploy do nothing: Turnstile solved the
  // challenge during render, the callback fired while pendingToken was still
  // null, and the token was discarded. The client then waited 15 seconds for a
  // second one that never came.
  //
  // HONEST CAVEAT: this test also passes against the buggy version. Reproducing
  // the failure needs the widget's internal state after reset() + execute(),
  // which this double does not model faithfully — two attempts at that only
  // produced a double that agreed with whatever it was pointed at. It is kept
  // because it pins the intended behaviour, not because it would have caught
  // the bug. What caught it, and what verified the fix, was driving the real
  // widget in a browser. See "The dual-write mirror" in db/README.md.
  const { api, calls } = await load({ turnstile: 'solves-on-render' });

  const result = await api.mirror(CREATE);

  assert.notEqual(result, null, 'the mirror must succeed, not time out');
  assert.equal(calls.fetch.length, 1);
  assert.ok(calls.fetch[0].body.turnstileToken, 'and it must carry a token');
});
