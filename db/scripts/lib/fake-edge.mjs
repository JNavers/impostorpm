/**
 * A PostgREST-shaped facade over PGlite, plus stubs for the two external
 * services the endpoints call.
 *
 * This is what lets the real Pages Functions be tested end to end with no
 * Supabase project, no network and no keys: the handlers are imported
 * unmodified and their fetch() calls are answered from a local Postgres.
 *
 * It implements exactly the four call shapes functions/api/compass/ uses. It
 * is a test double, not a PostgREST clone — if an endpoint starts using a
 * fifth shape, this must grow with it rather than the endpoint working around
 * it.
 */

const SUPABASE_URL = 'https://test.supabase.co';
const SERVICE_KEY = 'test-service-role-key';

export const TEST_ENV = {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  HASH_SALT: 'test-salt',
  RESEND_API_KEY: 'test-resend-key',
  SALARY_COMPASS_FROM_EMAIL: 'Test <test@impostor.pm>',
  SALARY_COMPASS_REPLY_TO: 'test@impostor.pm',
  // ON here so the existing tests keep exercising the sending path. Production
  // runs with it unset (= off) during dual-write; email-switch.test.mjs covers
  // that mode and asserts nothing is sent.
  COMPASS_SEND_EMAILS: 'true'
};

/**
 * @param db  a PGlite instance with the schema applied
 * @param opts.resend      'ok' | 'fail'
 * @param opts.turnstile   'ok' | 'fail'
 */
export function installFetch(db, opts = {}) {
  const calls = { resend: [], turnstile: [] };
  const original = globalThis.fetch;

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;

    if (url.includes('challenges.cloudflare.com')) {
      calls.turnstile.push(url);
      return jsonResponse({ success: opts.turnstile !== 'fail' });
    }

    if (url.includes('api.resend.com')) {
      calls.resend.push(JSON.parse(init.body));
      if (opts.resend === 'fail') return new Response('rate limited', { status: 429 });
      return jsonResponse({ id: 're_test_123' });
    }

    if (url.startsWith(`${SUPABASE_URL}/rest/v1/`)) {
      // The service role key must be presented, or the real PostgREST would
      // apply RLS and return nothing. Asserting it here catches a handler that
      // forgets the header, which would otherwise only fail in production.
      const auth = init.headers?.Authorization ?? '';
      if (!auth.includes(SERVICE_KEY)) return new Response('unauthorized', { status: 401 });
      return handleRest(db, url.slice(`${SUPABASE_URL}/rest/v1/`.length), init);
    }

    throw new Error(`fake-edge: unexpected fetch to ${url}`);
  };

  return {
    calls,
    restore() { globalThis.fetch = original; }
  };
}

async function handleRest(db, path, init) {
  const method = (init.method || 'GET').toUpperCase();

  // ── rpc/<fn> ──
  if (path.startsWith('rpc/')) {
    const fn = path.slice(4).split('?')[0];
    const args = JSON.parse(init.body || '{}');
    // JSON.stringify drops undefined values, so an argument the handler meant
    // to send but computed as undefined would vanish silently and the call
    // would fail with a confusing "function does not exist". Surface it here.
    const names = Object.keys(args);
    // Named arguments, exactly as PostgREST calls them, so a parameter renamed
    // in SQL without being renamed in the handler fails here too.
    const params = names.map((n, i) => `${n} => $${i + 1}`).join(', ');
    const values = names.map((n) => (
      args[n] !== null && typeof args[n] === 'object' ? JSON.stringify(args[n]) : args[n]
    ));

    try {
      // A function declared RETURNS TABLE/SETOF is a set, and PostgREST returns
      // an ARRAY of row objects for it — not a single scalar. Calling it as
      // `select fn(...)` instead would hand back one composite value, which is
      // not the shape the handler sees in production.
      const { rows: meta } = await db.query(
        'select proretset from pg_proc where proname = $1 limit 1', [fn]
      );
      const returnsSet = meta[0]?.proretset === true;

      if (returnsSet) {
        const { rows } = await db.query(`select * from ${fn}(${params})`, values);
        return jsonResponse(rows);
      }
      const { rows } = await db.query(`select ${fn}(${params}) as out`, values);
      return jsonResponse(rows[0]?.out ?? null);
    } catch (err) {
      return new Response(JSON.stringify({ message: err.message }), { status: 400 });
    }
  }

  const [table, query] = path.split('?');

  // ── insert ──
  if (method === 'POST') {
    const row = JSON.parse(init.body);
    const cols = Object.keys(row).filter((k) => row[k] !== undefined);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const values = cols.map((c) => (
      row[c] !== null && typeof row[c] === 'object' ? JSON.stringify(row[c]) : row[c]
    ));
    try {
      const { rows } = await db.query(
        `insert into ${table} (${cols.join(', ')}) values (${placeholders}) returning *`,
        values
      );
      return jsonResponse(rows);
    } catch (err) {
      return new Response(JSON.stringify({ message: err.message }), { status: 400 });
    }
  }

  // ── select ──
  if (method === 'GET') {
    const select = new URLSearchParams(query || '').get('select') || '*';
    const { rows } = await db.query(`select ${select} from ${table}`);
    return jsonResponse(rows);
  }

  return new Response('fake-edge: unsupported method', { status: 405 });
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

/** Cloudflare's caches.default, which Node does not provide. */
export function installCaches() {
  const store = new Map();
  const original = globalThis.caches;
  globalThis.caches = {
    default: {
      async match(req) {
        const hit = store.get(keyOf(req));
        return hit ? hit.clone() : undefined;
      },
      async put(req, res) {
        store.set(keyOf(req), res.clone());
      }
    }
  };
  return {
    store,
    restore() { globalThis.caches = original; }
  };
}

const keyOf = (req) => (typeof req === 'string' ? req : req.url);

/** Builds the request shape a Pages Function receives. */
export function makeRequest(body, { method = 'POST', ip = '203.0.113.7', url = 'https://www.impostor.pm/api/compass/submissions' } = {}) {
  return new Request(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
      'User-Agent': 'test-agent'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
