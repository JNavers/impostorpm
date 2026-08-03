(function() {
    var root = window;
    var cfg = root.TIPM_POSTHOG_CONFIG || {};
    var token = cfg.token || root.TIPM_POSTHOG_KEY || '';
    var apiHost = cfg.apiHost || cfg.api_host || 'https://eu.i.posthog.com';
    var uiHost = cfg.uiHost || cfg.ui_host || 'https://eu.posthog.com';
    var isLocalhost = ['localhost', '127.0.0.1', '0.0.0.0', ''].indexOf(root.location.hostname) !== -1
        || /\.local$/i.test(root.location.hostname)
        || root.location.protocol === 'file:';
    var disabled = cfg.disabled === true || !token || (isLocalhost && cfg.allowLocalhost !== true);
    var pagePath = root.location.pathname;
    var pageType = pagePath.indexOf('/compensation') !== -1
        ? 'compensation_landing'
        : (pagePath.indexOf('/salary-compass') !== -1 ? 'salary_compass_tool' : 'unknown');

    function noop() {}

    function cleanPath(url) {
        try {
            var parsed = new URL(url, root.location.href);
            return parsed.origin === root.location.origin
                ? parsed.pathname
                : parsed.hostname + parsed.pathname;
        } catch (e) {
            return '';
        }
    }

    function baseProps(extra) {
        var props = {
            product: 'salary_compass',
            page_type: pageType,
            path: root.location.pathname
        };
        if (extra) {
            Object.keys(extra).forEach(function(key) {
                props[key] = extra[key];
            });
        }
        return props;
    }

    function capture(event, props) {
        if (disabled || !root.posthog || typeof root.posthog.capture !== 'function') return;
        root.posthog.capture(event, baseProps(props));
    }

    function captureException(error, props) {
        if (disabled || !root.posthog) return;
        if (typeof root.posthog.captureException === 'function') {
            root.posthog.captureException(error, baseProps(props));
        } else {
            capture('tipm_client_exception', {
                message: error && error.message ? error.message : String(error),
                source: props && props.source
            });
        }
    }

    function capturePerformanceSnapshot() {
        if (!root.performance || disabled) return;
        var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
        var paint = performance.getEntriesByType ? performance.getEntriesByType('paint') : [];
        var fcp = null;
        for (var i = 0; i < paint.length; i++) {
            if (paint[i].name === 'first-contentful-paint') fcp = Math.round(paint[i].startTime);
        }
        if (nav) {
            capture('tipm_page_performance', {
                fcp_ms: fcp,
                ttfb_ms: Math.round(nav.responseStart),
                dom_content_loaded_ms: Math.round(nav.domContentLoadedEventEnd),
                load_ms: Math.round(nav.loadEventEnd),
                transfer_size_kb: nav.transferSize ? Math.round(nav.transferSize / 1024) : null
            });
        }

        var resources = performance.getEntriesByType ? performance.getEntriesByType('resource') : [];
        resources
            .filter(function(entry) { return entry.duration >= 500; })
            .sort(function(a, b) { return b.duration - a.duration; })
            .slice(0, 5)
            .forEach(function(entry) {
                capture('tipm_slow_resource', {
                    resource: cleanPath(entry.name),
                    initiator_type: entry.initiatorType || '',
                    duration_ms: Math.round(entry.duration),
                    transfer_size_kb: entry.transferSize ? Math.round(entry.transferSize / 1024) : null
                });
            });
    }

    function installVitalsObservers() {
        if (!('PerformanceObserver' in root) || disabled) return;
        var vitals = {
            lcp_ms: null,
            cls: 0,
            inp_ms: null,
            long_task_count: 0,
            long_task_total_ms: 0
        };

        try {
            new PerformanceObserver(function(list) {
                var entries = list.getEntries();
                entries.forEach(function(entry) {
                    vitals.lcp_ms = Math.round(entry.startTime);
                });
            }).observe({ type: 'largest-contentful-paint', buffered: true });
        } catch (e) {}

        try {
            new PerformanceObserver(function(list) {
                list.getEntries().forEach(function(entry) {
                    if (!entry.hadRecentInput) vitals.cls += entry.value;
                });
            }).observe({ type: 'layout-shift', buffered: true });
        } catch (e) {}

        try {
            new PerformanceObserver(function(list) {
                list.getEntries().forEach(function(entry) {
                    if (entry.interactionId && (vitals.inp_ms === null || entry.duration > vitals.inp_ms)) {
                        vitals.inp_ms = Math.round(entry.duration);
                    }
                });
            }).observe({ type: 'event', buffered: true, durationThreshold: 40 });
        } catch (e) {}

        try {
            new PerformanceObserver(function(list) {
                list.getEntries().forEach(function(entry) {
                    vitals.long_task_count += 1;
                    vitals.long_task_total_ms += Math.round(entry.duration);
                });
            }).observe({ type: 'longtask', buffered: true });
        } catch (e) {}

        function flushVitals() {
            capture('tipm_web_vitals', {
                lcp_ms: vitals.lcp_ms,
                cls: Number(vitals.cls.toFixed(4)),
                inp_ms: vitals.inp_ms,
                long_task_count: vitals.long_task_count,
                long_task_total_ms: vitals.long_task_total_ms
            });
        }

        root.addEventListener('pagehide', flushVitals, { once: true });
        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'hidden') flushVitals();
        }, { once: true });
    }

    function getExperiment(flagKey, fallback) {
        if (disabled || !root.posthog || typeof root.posthog.getFeatureFlag !== 'function') return fallback;
        var variant = root.posthog.getFeatureFlag(flagKey);
        if (variant === undefined || variant === null || variant === false) variant = fallback;
        var sessionKey = 'tipm_exp_' + flagKey;
        try {
            if (sessionStorage.getItem(sessionKey) !== String(variant)) {
                sessionStorage.setItem(sessionKey, String(variant));
                capture('tipm_experiment_exposure', { flag_key: flagKey, variant: variant });
            }
        } catch (e) {}
        if (typeof root.posthog.register_for_session === 'function') {
            var props = {};
            props['experiment_' + flagKey.replace(/[^a-zA-Z0-9_]/g, '_')] = variant;
            root.posthog.register_for_session(props);
        }
        return variant;
    }

    function identifyEmail(email, extraProps) {
        if (disabled || !email || !root.crypto || !crypto.subtle || !root.posthog) return;
        var normalized = String(email).trim().toLowerCase();
        var domain = normalized.indexOf('@') !== -1 ? normalized.split('@').pop() : '';
        crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized)).then(function(hash) {
            var bytes = Array.prototype.slice.call(new Uint8Array(hash));
            var id = bytes.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
            var props = { email_domain: domain };
            if (extraProps) {
                Object.keys(extraProps).forEach(function(key) { props[key] = extraProps[key]; });
            }
            root.posthog.identify('email_sha256_' + id, props);
        }).catch(noop);
    }

    root.tipmAnalytics = {
        enabled: !disabled,
        track: capture,
        captureException: captureException,
        captureTiming: function(event, startedAt, props) {
            capture(event, Object.assign({
                duration_ms: Math.round(performance.now() - startedAt)
            }, props || {}));
        },
        getExperiment: getExperiment,
        identifyEmail: identifyEmail
    };

    if (disabled) return;

    !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

    // Consent gate. This page is a common landing page, and until 2026-08-03 it
    // captured on load with nothing asked — the rest of the site had grown a
    // consent banner around it, which made the inconsistency both visible and
    // harder to defend. PostHog stores the opt-in decision itself, keyed by
    // project token and origin, so a decision made anywhere on impostor.pm is
    // already honoured here; this only covers the visitor whose FIRST page is
    // this one.
    var hasConsent = (function () {
        try { return localStorage.getItem('tipm_consent') === 'granted'; }
        catch (e) { return false; }
    })();

    root.posthog.init(token, {
        api_host: apiHost,
        ui_host: uiHost,
        defaults: '2026-01-30',
        opt_out_capturing_by_default: !hasConsent,
        capture_pageview: true,
        capture_pageleave: true,
        autocapture: {
            dom_event_allowlist: ['click', 'change', 'submit'],
            element_allowlist: ['a', 'button', 'input', 'select', 'textarea', 'label']
        },
        capture_exceptions: {
            capture_unhandled_errors: true,
            capture_unhandled_rejections: true,
            capture_console_errors: true
        },
        session_recording: {
            maskAllInputs: true,
            maskTextSelector: '.ph-mask'
        },
        loaded: function(ph) {
            ph.register({
                product: 'salary_compass',
                page_type: pageType,
                deployment_region: 'eu'
            });
            if (/[?&]__posthog_debug=true\b/i.test(root.location.search)) ph.debug(true);
            capture('tipm_posthog_loaded');
        }
    });

    root.addEventListener('tipm:consent-granted', function () {
        root.posthog.opt_in_capturing();
        capture('tipm_posthog_loaded');
    });
    root.addEventListener('tipm:consent-revoked', function () {
        root.posthog.opt_out_capturing();
    });

    root.addEventListener('load', function() {
        setTimeout(capturePerformanceSnapshot, 0);
    });
    root.addEventListener('error', function(event) {
        captureException(event.error || event.message, {
            source: 'window_error',
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno
        });
    });
    root.addEventListener('unhandledrejection', function(event) {
        captureException(event.reason || 'Unhandled rejection', { source: 'unhandledrejection' });
    });
    installVitalsObservers();
})();
