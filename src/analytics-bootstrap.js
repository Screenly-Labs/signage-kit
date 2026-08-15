// The GA4 bootstrap, as an inline <head> snippet. It does two jobs, both of which have to
// happen before the first event is sent: it makes one screen ONE GA4 user, and it makes that
// screen's first page view attributable to a player.
//
// THE SECOND PROBLEM: THE FIRST PAGE VIEW IS ALWAYS UNATTRIBUTED.
//
// `trackPlayer` sets the player user properties from `main.js`, after DOMContentLoaded. The
// automatic `page_view` goes out with the `gtag('config')` call below, which is necessarily
// earlier. So under any given client_id the first page view carries no player fields. Where the
// id survives, every later page view is attributed and the loss is invisible; where the id is
// minted fresh on every load, NO page view is ever attributed.
//
// Measured on 2026-08-14: `player_vendor=yodeck` reported 150 users, 150 sessions, 150 events
// and zero page views, every event a `player_detected` from a Fire TV WebView that boots with
// fresh storage each load. BrightSign showed the same shape at 913 users and 3 page views.
// Fleet-wide 21% of app runs carried no player fields, and the bias falls on exactly the
// high-churn players a census most needs to see.
//
// The fix costs nothing here, because this snippet ALREADY waits for the profile before
// configuring: the Worker returns ready-made user properties beside it (see
// ./analytics-server) and they are set in the same deferred moment. `trackPlayer` still runs
// later and tops up the three measured-capability fields, which need a DOM to probe; user
// properties are last-write-wins, so the later, richer set simply supersedes this one.
//
// Static apps have no server to build the profile, so they do not get this and their page
// views stay unattributed. Closing that gap needs a user-agent-only detect inlined here, which
// is a bigger change than it looks: the profiler is not small, and this string ships in the
// <head> of every page.
//
// THE FIRST PROBLEM IT SOLVES.
//
// GA4's client_id lives in the _ga cookie, and these players largely boot with fresh storage,
// so a screen mints a new client_id constantly. Real device identity made the scale of it
// visible: some screens mint a fresh id on essentially every page load while others keep one
// across hundreds, so GA4's unique identifier does not identify a screen, and the churn rate
// varies per screen rather than per vendor.
//
// A Screenly player that sends asset metadata carries a stable device id, and ./screenly-metadata
// hashes it into a `client_id`-shaped value. Handing that to `gtag('config')` makes GA4's own
// identifier the same for a screen for as long as the device exists.
//
// WHY THIS IS AN INLINE SNIPPET AND NOT PART OF THE BUNDLE.
//
// `client_id` is stamped onto every event as it is sent, so it has to be in place before the
// first one. Two consequences:
//
//   1. `config` has to WAIT for the device id, which arrives from a fetch. So this defers
//      `config` rather than calling it immediately, and it has to be the thing that owns the
//      call, not something that patches it afterwards.
//   2. It cannot live in main.js. That bundle is a separate request, and on a signage fleet a
//      meaningful share of screens fire a page_view and never get further. If `config` moved
//      into the bundle, those screens would report NOTHING instead of a page_view, so a fix for
//      counting would become a loss of data. Inline in the same <head> as the gate, the call is
//      guaranteed.
//
// It also must NOT be baked into the HTML per-screen. The SSR page cache is keyed with no
// user-agent or header component, so a client_id rendered into that HTML would be served to
// every screen that hit the cache afterwards and the whole fleet would collapse onto one GA4
// user. That is why the id is fetched from the no-store profile endpoint at runtime instead.
//
// FAILS OPEN, ALWAYS.
//
// Every path ends in exactly one `config` call: on the profile arriving, on the fetch failing,
// or on a timeout. An unattended screen with a stalled network still reports, it just reports
// with GA4's default cookie behaviour. Telemetry must never be the reason a screen goes quiet.

/**
 * Build the inline bootstrap.
 *
 * @param {object} options
 * @param {string} options.gaId            GA4 measurement id, e.g. `G-XXXXXXX`.
 * @param {string} [options.profilePath]   The no-store profile route, normally
 *   `PLAYER_PROFILE_PATH`. Omit it for the static apps: they have no server to read the
 *   metadata headers, so there is no device id to wait for and `config` runs immediately.
 * @param {number} [options.timeoutMs]     How long to wait for the profile before configuring
 *   without it. Default 1500. Kept short: it delays the first page_view.
 * @param {Record<string, string|number>} [options.configParams] Extra `config` params to merge,
 *   for an app that already sends some (the reader sends its feed). Merged UNDER `client_id` so
 *   an app cannot accidentally override the device identity.
 * @returns {string} An HTML `<script>` block.
 */
// Note on `window.dataLayer.push` rather than Google's canonical bare `dataLayer.push`: the
// bare form only resolves because `window` IS the global object. Being explicit is equivalent
// in a browser, and it lets the snippet be executed against a stub so the tests exercise the
// string that actually ships.
export function analyticsBootstrap({ gaId, profilePath, timeoutMs = 1500, configParams }) {
  if (!gaId) throw new Error('analyticsBootstrap: gaId is required')

  // Serialised for embedding in a <script>. Escaping `<` alone is sufficient to keep injected
  // markup inert, since `</` is the only sequence that can terminate the element early, but `>`
  // is escaped too: this replaces per-app helpers that escaped both, and a drop-in for something
  // security-relevant should be at least as strict as what it replaces, never less. U+2028/9 are
  // literal line terminators in a script context.
  const params = JSON.stringify(configParams ?? {})
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  // Omitted entirely when empty, so an app with no params emits exactly Google's own snippet.
  const paramsArg = params === '{}' ? '' : `, ${params}`

  // No profile endpoint means no device id can ever exist, so keep the plain snippet rather
  // than paying a deferral for nothing.
  if (!profilePath) {
    return `<!-- Google tag (gtag.js) (@screenly-labs/signage-kit) -->
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){window.dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${gaId}'${paramsArg});
    </script>`
  }

  return `<!-- Google tag (gtag.js), player fields and client_id set before the first hit (@screenly-labs/signage-kit) -->
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){window.dataLayer.push(arguments);}
      gtag('js', new Date());
      (function () {
        var configured = false;
        // Exactly one config call on every path, so a stalled fetch cannot leave a screen
        // silent. A screen reporting under a churning id is bad; a screen reporting nothing
        // is worse.
        function configure(clientId, properties) {
          if (configured) return;
          configured = true;
          // Set BEFORE config, so the automatic page_view carries the player fields. See the
          // note above: without this, the first page view under any client_id is unattributed.
          if (properties) gtag('set', 'user_properties', properties);
          var cfg = ${params};
          // client_id last, so it always wins over app-supplied params.
          if (clientId) cfg.client_id = clientId;
          gtag('config', '${gaId}', cfg);
        }
        var timer = setTimeout(function () { configure(null, null); }, ${timeoutMs});
        function settle(profile) {
          // Stashed so the app bundle can reuse it instead of fetching the same no-store
          // endpoint a second time.
          window.__playerProfile = profile || null;
          clearTimeout(timer);
          configure(
            profile && profile.gaClientId ? profile.gaClientId : null,
            profile ? profile.userProperties : null
          );
        }
        try {
          fetch('${profilePath}', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(settle)
            .catch(function () { settle(null); });
        } catch (e) {
          settle(null);
        }
      })();
    </script>`
}
