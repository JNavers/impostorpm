/**
 * Dual-write: mirrors every write to the new Compass backend while the Apps
 * Script one stays authoritative.
 *
 * Step 3 of the migration in db/README.md. For a week or two both backends
 * receive every submission and the two datasets get compared daily; reads keep
 * coming from Apps Script until that comparison is boring.
 *
 * It lives in its own file rather than inside index.html on purpose. That page
 * is 5,000 lines, is asserted byte-identical by scripts/validate-production.mjs,
 * and is the single most delicate file in the repo. Keeping the change there to
 * four lines makes this reviewable.
 *
 * Three rules it follows:
 *
 *  1. NEVER let a mirror failure affect the user. The old path is what counts
 *     during dual-write; if this file throws, the visitor must not notice.
 *     Every entry point swallows its own errors.
 *  2. Fire and forget, but measurably. Outcomes go to PostHog so the mirror's
 *     success rate is visible — the whole reason for dual-write is to find out
 *     whether the new path is reliable before trusting it.
 *  3. One switch to turn it off: COMPASS_DUAL_WRITE below.
 */
(function () {
  'use strict';

  /** Flip to false to stop mirroring. This is the rollback. */
  var COMPASS_DUAL_WRITE = true;

  var API_BASE = '/api/compass';

  /**
   * Public on purpose: a Turnstile sitekey identifies the widget, it does not
   * authorise anything. The secret lives only in the Worker.
   */
  var TURNSTILE_SITEKEY = '0x4AAAAAAE_8GTLACwscn7x9';

  /**
   * Hosts the Turnstile widget is registered for. Anywhere else — localhost, a
   * custom domain — Turnstile cannot issue a usable token, so the mirror is
   * skipped entirely rather than sending writes the backend will reject with
   * 403. A wall of failures that all mean "wrong hostname" would drown the
   * ones that mean something.
   *
   * Preview deployments are served from <hash>.impostorpm-site.pages.dev, and
   * Turnstile matches subdomains of a registered domain, so the bare project
   * host covers every preview. Matching has to allow subdomains here too, or
   * the client would disable itself on exactly the hosts the widget now
   * accepts.
   */
  var TURNSTILE_HOSTS = ['impostor.pm', 'www.impostor.pm', 'impostorpm-site.pages.dev'];

  function hostAllowed(hostname) {
    for (var i = 0; i < TURNSTILE_HOSTS.length; i++) {
      var domain = TURNSTILE_HOSTS[i];
      // The leading dot is what stops "notimpostor.pm" matching "impostor.pm".
      if (hostname === domain || hostname.slice(-(domain.length + 1)) === '.' + domain) {
        return true;
      }
    }
    return false;
  }

  var enabled = COMPASS_DUAL_WRITE && hostAllowed(window.location.hostname);

  /**
   * The new backend assigns its own uuid, while the Sheet keys off an id the
   * client generates. The survey arrives as a separate call minutes later and
   * has to reach the same row, so the mapping is kept here for the page's life.
   */
  var idMap = {};

  var turnstileReady = null;
  var widgetId = null;

  /**
   * Turnstile delivers tokens through the callback given to render(), not to
   * execute(), so the promise waiting for one is parked here.
   */
  var pendingToken = null;

  function track(event, props) {
    try {
      if (window.tipmAnalytics && window.tipmAnalytics.capture) {
        window.tipmAnalytics.capture(event, props);
      } else if (window.posthog && window.posthog.capture) {
        window.posthog.capture(event, props);
      }
    } catch (e) { /* analytics must never break a write path */ }
  }

  /** Loads the Turnstile script once and renders one invisible widget. */
  function ensureTurnstile() {
    if (turnstileReady) return turnstileReady;

    turnstileReady = new Promise(function (resolve, reject) {
      if (window.turnstile) return resolve();

      var script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error('turnstile-script-failed')); };
      document.head.appendChild(script);
    }).then(function () {
      if (widgetId !== null) return;

      var host = document.createElement('div');
      host.id = 'compass-turnstile';
      // NOT display:none. Turnstile refuses to run in a hidden container, and
      // appearance:'execute' already keeps the widget invisible until it
      // actually needs to show an interactive challenge — at which point the
      // visitor has to be able to see it.
      host.style.position = 'fixed';
      host.style.bottom = '12px';
      host.style.right = '12px';
      host.style.zIndex = '2147483647';
      document.body.appendChild(host);

      widgetId = window.turnstile.render(host, {
        sitekey: TURNSTILE_SITEKEY,
        // 'execute' on both: render the widget but do not start a challenge
        // until execute() is called, and stay invisible until one is needed.
        // There is no size:'invisible' — the valid sizes are normal, flexible
        // and compact, and passing anything else makes render() fail silently.
        execution: 'execute',
        appearance: 'execute',
        // The token arrives HERE, not from execute(). execute() only starts
        // the challenge and returns nothing.
        callback: function (token) {
          if (!pendingToken) return;
          var p = pendingToken;
          pendingToken = null;
          p.resolve(token);
        },
        'error-callback': function () {
          if (!pendingToken) return;
          var p = pendingToken;
          pendingToken = null;
          p.reject(new Error('turnstile-error'));
          return true; // we handled it; do not let Turnstile retry on its own
        },
        'timeout-callback': function () {
          if (!pendingToken) return;
          var p = pendingToken;
          pendingToken = null;
          p.reject(new Error('turnstile-timeout'));
        }
      });
    });

    return turnstileReady;
  }

  /**
   * One token per call. Turnstile tokens are single-use and expire after five
   * minutes, so reusing one across the comparison and the survey — which can be
   * many minutes apart — would fail the second time.
   */
  function getToken() {
    return ensureTurnstile()
      .then(function () {
        return new Promise(function (resolve, reject) {
          var settled = false;
          var timer = setTimeout(function () {
            if (settled) return;
            settled = true;
            pendingToken = null;
            reject(new Error('turnstile-timeout'));
          }, 15000);

          pendingToken = {
            resolve: function (token) {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              resolve(token);
            },
            reject: function (err) {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              reject(err);
            }
          };

          try {
            // Tokens are single-use and expire after five minutes, so each
            // call starts a fresh challenge rather than reusing the last one.
            window.turnstile.reset(widgetId);
            window.turnstile.execute(widgetId);
          } catch (e) {
            pendingToken = null;
            clearTimeout(timer);
            settled = true;
            reject(e);
          }
        });
      });
  }

  function post(path, body) {
    return fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(readResponse);
  }

  function patch(path, body) {
    return fetch(API_BASE + path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(readResponse);
  }

  function readResponse(res) {
    return res.text().then(function (text) {
      var parsed;
      try { parsed = JSON.parse(text); } catch (e) { parsed = { raw: text.slice(0, 200) }; }
      if (!res.ok) {
        var err = new Error('http-' + res.status);
        err.status = res.status;
        err.body = parsed;
        throw err;
      }
      return parsed;
    });
  }

  // ── Payload translation ──
  // The Apps Script payloads are flat and use its own field names. Rather than
  // change 4 call sites in index.html, the shapes are translated here.

  function createBody(data, token) {
    return {
      role: data.role,
      baseSalary: data.baseSalary,
      totalComp: data.totalComp === '' ? null : data.totalComp,
      yoe: data.yoe === '' ? null : data.yoe,
      city: data.city || null,
      perceptionGuess: data.perceptionGuess,
      source: 'compare',
      turnstileToken: token
    };
  }

  /** Everything the survey sends except the routing fields. */
  var SURVEY_SKIP = { action: 1, id: 1, dashboardToken: 1, email: 1, resend_via: 1,
    email_sent: 1, email_error: 1, report_optin: 1, newsletter_optin: 1 };

  function surveyBody(data) {
    var out = {};
    Object.keys(data).forEach(function (key) {
      if (SURVEY_SKIP[key]) return;
      var value = data[key];
      if (value === undefined || value === null || value === '') return;
      out[key] = value;
    });
    return out;
  }

  function contactBody(data, token) {
    var compassId = idMap[data.submission_id || data.submissionId || data.id];
    return {
      email: data.email,
      source: data.source || 'dashboard_waitlist',
      submission_id: compassId || null,
      report_optin: data.report_optin === true || data.report_optin === 'true',
      newsletter_optin: data.newsletter_optin === true || data.newsletter_optin === 'true',
      percentile: data.percentile === '' ? null : data.percentile,
      turnstileToken: token
    };
  }

  // ── Entry point ──

  /**
   * Mirrors one Apps Script payload. Always resolves: a rejected promise here
   * would surface as an unhandled rejection in the page, and during dual-write
   * this path is not allowed to matter.
   */
  function mirror(data) {
    if (!enabled || !data || !data.action) return Promise.resolve(null);

    var action = data.action;
    var started = (window.performance && performance.now) ? performance.now() : 0;

    return getToken()
      .then(function (token) {
        if (action === 'create') {
          return post('/submissions', createBody(data, token)).then(function (res) {
            if (res && res.id) idMap[data.id] = res.id;
            return res;
          });
        }

        if (action === 'update') {
          var compassId = idMap[data.id];
          if (!compassId) {
            // The comparison's mirror failed, so there is no row to enrich.
            // Recorded rather than retried: inventing a submission here would
            // put a survey in the dataset with no salary attached to it.
            var err = new Error('no-mirrored-submission');
            err.expected = true;
            throw err;
          }
          return patch('/submissions/' + encodeURIComponent(compassId), surveyBody(data));
        }

        if (action === 'email_only') {
          return post('/contacts', contactBody(data, token));
        }

        return null;
      })
      .then(function (res) {
        track('compass_mirror_ok', {
          action: action,
          ms: started ? Math.round(performance.now() - started) : undefined
        });
        return res;
      })
      .catch(function (err) {
        track('compass_mirror_failed', {
          action: action,
          reason: err && err.message,
          status: err && err.status,
          expected: !!(err && err.expected),
          ms: started ? Math.round(performance.now() - started) : undefined
        });
        return null;
      });
  }

  window.compassDualWrite = {
    mirror: mirror,
    enabled: enabled,
    /** Exposed for the console: compassDualWrite.idMap to see what got mirrored. */
    idMap: idMap
  };
})();
