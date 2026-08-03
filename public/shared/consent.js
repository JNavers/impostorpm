/**
 * Cookie consent, shared by the Astro site and the standalone Salary Compass.
 *
 * It injects its own markup and styles rather than expecting them in the page,
 * because the two consumers have no template in common: one renders through
 * src/layouts/Base.astro, the other is hand-written HTML in public/. Keeping the
 * markup here is what makes this the single source — an earlier version lived in
 * both files with a comment telling the next person to edit them together, which
 * is a bug waiting for a deadline.
 *
 * Opt-in, not opt-out: nothing is captured until Accept. The audience is largely
 * Portugal and Spain, so implied consent does not count.
 *
 * Contract with analytics, relied on by both consumers:
 *   localStorage 'tipm_consent'  →  'granted' | 'denied' | absent
 *   window event 'tipm:consent-granted'  /  'tipm:consent-revoked'
 * Anything with [data-consent-reopen] reopens it, which is how withdrawing stays
 * as easy as giving — a GDPR requirement, not a nicety.
 */
(function () {
  var KEY = 'tipm_consent';
  var POLICY = 'https://www.iubenda.com/privacy-policy/26472145/cookie-policy';

  function read() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function write(value) {
    // Storage can be blocked (private mode, embedded webviews). Failing to
    // persist means the banner asks again next visit, which is the safe outcome.
    try { localStorage.setItem(KEY, value); } catch (e) {}
  }

  var STYLES =
    '.tipm-consent{position:fixed;z-index:2000;left:1rem;right:1rem;bottom:1rem;max-width:34rem;' +
    'margin-inline:auto;padding:1.25rem;background:#fff;border:1px solid rgba(0,0,0,.12);' +
    'border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,.12);display:flex;flex-direction:column;' +
    'gap:1rem;font-size:.9375rem;line-height:1.5;color:#1e1e1e}' +
    '.tipm-consent[hidden]{display:none}' +
    '.tipm-consent p{margin:0;color:#555}' +
    '.tipm-consent-actions{display:flex;gap:.75rem;justify-content:flex-end}' +
    '.tipm-consent-actions button{font:inherit;border-radius:4px;padding:.65rem 1.75rem;cursor:pointer}' +
    '.tipm-consent-actions [data-consent=accept]{background:#ffc600;color:#1e1e1e;border:none;font-weight:500}' +
    '.tipm-consent-actions [data-consent=decline]{background:transparent;color:#000;border:1.5px solid #000}' +
    '@media (max-width:767.98px){.tipm-consent{left:.75rem;right:.75rem;bottom:.75rem}' +
    '.tipm-consent-actions{justify-content:center}}';

  function build() {
    var style = document.createElement('style');
    style.textContent = STYLES;
    document.head.appendChild(style);

    var el = document.createElement('div');
    el.className = 'tipm-consent';
    el.id = 'tipm-consent';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', 'Cookie consent');
    el.hidden = true;
    el.innerHTML =
      '<p>We use analytics to understand what\'s useful on this site. ' +
      'Nothing is collected until you agree. ' +
      '<a href="' + POLICY + '" target="_blank" rel="noreferrer">Cookie policy</a></p>' +
      '<div class="tipm-consent-actions">' +
      '<button type="button" data-consent="decline">Decline</button>' +
      '<button type="button" data-consent="accept">Accept</button>' +
      '</div>';
    document.body.appendChild(el);
    return el;
  }

  function start() {
    var el = document.getElementById('tipm-consent') || build();

    // Only ask when there is no decision yet. A stored "denied" is a decision;
    // re-asking every visit is what trains people to click Accept to make it go
    // away, which is not consent.
    if (!read()) el.hidden = false;

    el.addEventListener('click', function (event) {
      var choice = event.target && event.target.getAttribute('data-consent');
      if (!choice) return;
      if (choice === 'accept') {
        write('granted');
        window.dispatchEvent(new Event('tipm:consent-granted'));
      } else {
        write('denied');
        window.dispatchEvent(new Event('tipm:consent-revoked'));
      }
      el.hidden = true;
    });

    document.addEventListener('click', function (event) {
      var target = event.target;
      if (target && target.closest && target.closest('[data-consent-reopen]')) {
        event.preventDefault();
        el.hidden = false;
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
