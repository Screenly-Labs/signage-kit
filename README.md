# @screenly-labs/signage-kit

Shared build pipeline, degraded-mode layer, and base Tailwind preset for the
Screenly-Labs signage apps. It exists to DRY up the parts that were copy-pasted
across ~15 app repos (and had to be re-fixed several times): the browser-support
**floor**, the CSS down-leveling recipe, the JS bundler, the degraded-mode
**gate**, the `replaceChildren` **shim**, the `html.legacy` **kill-switch**, the
canonical **webfonts**, the **footer badge** + its Screenly-player hide logic, and
the fluid **viewport** foundation.

The apps keep their own **design identity** — palette, display fonts, layout,
signature element. Only the plumbing and the brand chrome are shared.

## Install

```sh
bun add @screenly-labs/signage-kit
# required peers: esbuild lightningcss browserslist
# Tailwind apps also: postcss @csstools/postcss-cascade-layers (optional peers,
# only loaded by processCss({ flattenLayers: true }) — raw-CSS Worker apps skip them)
```

## What it provides

| Export | Use |
| --- | --- |
| `@screenly-labs/signage-kit/build` | `FLOOR`, `GATE`, `FONT_URL_PREFIX`, `injectGate`, `processCss`, `bundleJs` — the build-time pipeline |
| `@screenly-labs/signage-kit/gate` | `GATE` only, with **no build deps** — safe to import from a Worker SSR template |
| `@screenly-labs/signage-kit/polyfills` | the `replaceChildren` shim (import for side effect, first line of your entry) |
| `@screenly-labs/signage-kit/branding` | `isScreenlyPlayer()`, `removeScreenlyBranding()` — hide the promo badge on Screenly players |
| `@screenly-labs/signage-kit/profiler` | `detectPlayer()`, `detectPlayerFromRequest()`, `vendorFromPackage()` — identify which player/device a request comes from |
| `@screenly-labs/signage-kit/analytics` | `trackPlayer()` — report the player profile to GA4 as user properties + a `player_detected` event |
| `@screenly-labs/signage-kit/analytics-server` | `playerProfileResponse()` — Worker route serving the live request's profile `no-store`, for the header-enriched vendors |
| `@screenly-labs/signage-kit/analytics-schema` | `PLAYER_DIMENSIONS`, `PLAYER_METRICS` — the GA4 custom dimensions/metrics to register, as data |
| `@screenly-labs/signage-kit/capability` | `detectCapability()` — measured degraded verdict + CSS support, for the screens whose UA has no version |
| `@screenly-labs/signage-kit/analytics-bootstrap` | `analyticsBootstrap()`: the inline `<head>` GA4 tag that sets the player fields and pins `client_id` to the device before the first hit |
| `@screenly-labs/signage-kit/screenly-metadata` | `screenlyMetadataFromRequest()`, `screenlyDeviceId()`, `hashDeviceId()` — the `X-Screenly-*` headers, incl. the only stable per-device id |
| `@screenly-labs/signage-kit/sync-fonts` | `syncFonts()` + the version-pinned `FONTS` manifest — vendor the shared woff2 |
| `@screenly-labs/signage-kit/styles/preset.css` | base Tailwind layer: brand/font/hairline tokens, tunable fluid root, resets, `svh` fallback, the degraded layer |
| `@screenly-labs/signage-kit/styles/fonts.css` | `@font-face` for the canonical webfont set (Fraunces, Hanken Grotesk, Bricolage, Newsreader, Space Mono, JetBrains Mono) |
| `@screenly-labs/signage-kit/styles/brand.css` | the standardized corner `.brand` badge |
| `@screenly-labs/signage-kit/styles/header.css` | optional `.masthead` + `.eyebrow` chrome |
| `@screenly-labs/signage-kit/styles/stage.css` | optional `.stage` full-viewport centering frame |
| `@screenly-labs/signage-kit/styles/degraded.css` | just the `html.legacy` kill-switch |
| `@screenly-labs/signage-kit/screenly-logo.svg` | the canonical Screenly wordmark (copy into the app's `/static/images/`) |

The support **floor** (`FLOOR` = `chrome >= 87, safari >= 14.1, firefox >= 78,
edge >= 87`) lives here, once. It's the honest minimum where the apps' modern CSS
renders natively: `clamp()`/`min()`/`max()` (Chrome 79 / Safari 11.1) **and**
logical properties like `inset-inline-end` (Chrome 87 / Safari 14.1, which Lightning
CSS can't safely lower). Change it here and every app that builds through the kit
picks it up.

## Usage by app type

**Static Tailwind app** (e.g. birthday):

```css
/* assets/static/styles/tailwind.css */
@import 'tailwindcss';                                   /* MUST stay in the app (see gotchas) */
@import '@screenly-labs/signage-kit/styles/preset.css';
@theme { /* your palette + display font */ }
/* your component styles + any app-specific html.legacy resting state */
```

```js
// build.js
import { bundleJs, injectGate, processCss } from '@screenly-labs/signage-kit/build'
await writeFile(`${DIST}/index.html`, injectGate(await readFile('index.html', 'utf8')))
// tailwind CLI -> cssOut, then:
await writeFile(cssOut, await processCss(await readFile(cssOut, 'utf8'), { flattenLayers: true, filename: cssOut }))
await bundleJs('assets/static/js/main.ts', `${DIST}/static/js/main.js`)
```

```ts
// main.ts
import '@screenly-labs/signage-kit/polyfills'
```

**Cloudflare Worker (raw CSS)** (e.g. moon) — the gate goes in the SSR template,
and the kill-switch is prepended by `processCss` (no `@import` resolution):

```tsx
// Layout.tsx
import { html, raw } from 'hono/html'
import { GATE } from '@screenly-labs/signage-kit/gate'
// ... ${raw(GATE)} before <link rel="stylesheet" ...>
```

```ts
// build.ts
import { bundleJs, processCss } from '@screenly-labs/signage-kit/build'
await bundleJs('assets/static/js/main.ts', 'assets/static/js/main.js')
await Bun.write(path, await processCss(await Bun.file(path).text(), { includeDegraded: true, filename: path }))
```

**Static ESM app** (e.g. world-clock) — same as static, but bundle as a module:

```ts
await bundleJs('src/main.ts', `${DIST}/main.js`, { format: 'esm' })
```

### What stays in the app

The generic kill-switch is shared, but any element whose base state is
off-screen/invisible and relies on animation to appear needs an **app-specific**
`html.legacy` resting rule — a falling-confetti scatter, an entrance that starts at
`opacity: 0`, a container-query-sized time. That's design-specific, so it lives in
the app.

## Shared chrome

**Fonts.** The canonical `@font-face` set lives in `styles/fonts.css`. The matching
`@fontsource` packages are **dependencies of this kit** (bun + the lockfile own the
versions in one place), so apps carry **no `@fontsource` deps of their own** — they
get the files transitively and vendor the subset they use:

```css
@import '@screenly-labs/signage-kit/styles/fonts.css';
@theme { --font-display: 'Fraunces', ui-serif, Georgia, serif; } /* pick your display */
```

```js
// build step — vendor woff2 into assets/static/fonts (served at /static/fonts/)
import { syncFonts } from '@screenly-labs/signage-kit/sync-fonts'
await syncFonts(['fraunces', 'hanken-grotesk'])
```

`syncFonts()` resolves the files from wherever bun placed them; the `FONTS` manifest
in `sync-fonts` maps each family key to its package + woff2. `@font-face` is lazy, so
importing the whole sheet only downloads the families your rendered text actually
uses. `--font-sans` / `--font-display` / `--font-mono` tokens are set in `preset.css`;
override the display/mono choice per app. To add a family, `bun add` it here and add
a manifest entry + `@font-face` — never pin `@fontsource` versions in an app.

`fonts.css` points every `src` at `/static/fonts/…`, absolute from the document
root. That is right for an app served at the root and wrong for a consumer served
from a **subpath** — a WordPress plugin under
`/wp-content/plugins/<slug>/`, a GitHub project page under `/<repo>/` — where every
face 404s. Pass `fontPath` to `processCss` to rewrite the prefix, matching the
`destDir` you gave `syncFonts()`:

```js
await syncFonts(['fraunces'], `${DIST}/fonts`)
// Relative URLs resolve against the stylesheet, so this works no matter where the
// consumer is mounted, including a subdirectory install.
await Bun.write(cssOut, await processCss(css, { flattenLayers: true, fontPath: 'fonts/' }))
```

Without it such a consumer has to hand-maintain a duplicate `@font-face` block, and
the kit stops being the single owner of which font files ship — which is most of the
point of `FONTS`.

**Footer badge.** `@import styles/brand.css`, copy `screenly-logo.svg` into
`/static/images/`, render the anchor, and call the remover from your entry:

```ts
import { removeScreenlyBranding } from '@screenly-labs/signage-kit/branding'
removeScreenlyBranding() // removes .brand on Screenly players; no-op elsewhere
```

**Fluid root.** `preset.css` drives the whole type scale from three tunable stops —
override only these, never restate the clamp:

```css
:root { --root-min: 17px; --root-gain: 1.05; --root-max: 56px; }
```

## Player profiler

`detectPlayer()` identifies which signage player (or non-player) a request comes from,
using the three signals a device leaks: the **user agent**, the **referrer**, and — server
side only — the Android WebView **`X-Requested-With`** package name. It returns a structured
profile rather than a single flag:

```ts
import { detectPlayer } from '@screenly-labs/signage-kit/profiler'

const p = detectPlayer() // reads navigator.userAgent + document.referrer
// { vendor: 'yodeck' | 'screenly' | 'brightsign' | … | null,
//   platform: 'firetv' | 'chromeos' | … | null,
//   model: 'XT1144' | 'AFTKA' | 'MBR-1100' | … | null,   // device model from the UA
//   category: 'signage' | 'meeting-room' | 'browser' | 'bot',
//   engine: { name: 'qtwebengine' | 'chromium' | 'webkit' | … | null, version: 87 | null },
//   belowFloor: true | false | null,                     // renders below the build FLOOR?
//   confidence: 'high' | 'medium' | 'low',
//   sources: ['userAgent', 'referrer'] }
```

`engine` + `belowFloor` are often the most actionable fields: `belowFloor` is `true` when the
device's engine renders below the build [`FLOOR`](src/build.js) (Chrome 87 / Safari 14.1 /
Firefox 78) and therefore leans on the degraded gate + LightningCSS down-levelling rather
than native modern CSS — a large share of the real fleet (e.g. Chrome 83 QtWebEngine players
and Chrome 65 BrightSign units) sits there. The floor constants mirror `src/build.js` and are
kept in sync by hand (that module can't be imported here — it pulls build-only deps).

Called with no arguments in the browser it reads the globals (safe when absent — SSR /
Workers just get `''`). Two things page JS **cannot** see are worth knowing:

- **Request headers are not exposed to page JS.** The `X-Requested-With` package is a
  third, optional argument for server-side callers (a Worker/SSR that has the header):
  `detectPlayer(ua, referrer, requestedWith)`. `vendorFromPackage(pkg)` maps a package on
  its own. At runtime the profiler works from UA + referrer only.

  On the server, use `detectPlayerFromRequest(request)` — it reads `User-Agent`, `Referer`,
  and `X-Requested-With` off the request and factors in whichever are present, so the
  Worker apps (e.g. `weather`, `clock`) get the full three-signal profile while a static
  app just gets UA + referrer. Prefer it over the no-arg form on a Worker, where the
  `navigator`/`document` globals describe the runtime (`navigator.userAgent` is
  `"Cloudflare-Workers"`), not the visitor.

  ```ts
  import { detectPlayerFromRequest } from '@screenly-labs/signage-kit/profiler'
  // Cloudflare Worker
  export default {
    fetch(req: Request): Response {
      const player = detectPlayerFromRequest(req)
      return new Response(JSON.stringify(player), { headers: { 'content-type': 'application/json' } })
    },
  }
  ```
- **Referrers to the app's own `*.srly.io` hosts identify the *content*, not the player,**
  so they're ignored. Instead, the referrer helps recover a vendor the UA hides — e.g.
  `player.yodeck.com` (Yodeck buried in a generic Fire TV UA) or `pisignage.com` (piSignage
  sends no UA token at all).

Notes baked into the classifier: **Anthias** is only claimed on the explicit `Anthias/`
UA token — the large bare-`QtWebEngine` bucket is the same engine but is reported as
`{ vendor: null, category: 'signage', confidence: 'low' }`, never attributed to Anthias.
**Screenly** detection is the original `screenly-viewer` check, enriched to also match
`ScreenlyWebview` and `screenly-viewer/2.0`. The token set lives in a tiny `screenly-ua`
leaf module that both this profiler and `./branding` import, so `isScreenlyPlayer()` and
`detectPlayer()` share one definition (and can't drift) without `./branding` pulling the
full profiler into its bundle.

Three platform/engine rules are worth knowing before you read a report:

- **`raspberry-pi` is not the Pi census.** The only Pi token is the legacy `Raspbian`
  string, absent from current Raspberry Pi OS, whose UA is a bare `(X11; Linux aarch64)`.
  Modern Pis therefore report `linux-arm`, which is honest about what the UA proves. For an
  actual Pi count, use vendor `anthias`.
- **`AppleWebKit/537.36` with no `Version/` is Blink, not WebKit.** Chromium froze that
  version string and never moved it, and real Safari always sends `Version/`. This is what
  the Screenly v1 viewer UA looks like, so misreading it put `engine: 'webkit'` and a null
  `belowFloor` on the largest fleet in the census.
- **`chromeos` and `linux-arm` count as signage-capable**, not browsers, when no vendor is
  identified. Both are judgement calls, and the reasoning is written out at
  `BROWSER_PLATFORMS` in `src/profiler.ts`.

`belowFloor` is still `null` whenever the UA carries no version token at all, which
includes the Screenly v1 viewer. Fixing the engine family does not conjure a version that
was never in the string, so `player_below_floor` is not a fleet-wide signal and never can be.
Use the measured `player_degraded` and `player_css_support` for that; see
[Measured capability](#measured-capability-and-why-it-exists-alongside-player_below_floor).

## Player telemetry (GA4)

`./analytics` turns a `PlayerProfile` into the shape GA4 can report on, so every app
answers one question the same way: **which players are showing this app?**

GA4's own device dimensions cannot answer it. In a large sample of one app, the overwhelming majority of
devices reported as `Safari / Linux / smart tv` with `deviceModel` "(not set)",
because a QtWebEngine player looks like Safari to GA's UA parser. Nothing standard
separates a BrightSign from an Anthias.

```ts
import { detectPlayer } from '@screenly-labs/signage-kit/profiler'
import { trackPlayer } from '@screenly-labs/signage-kit/analytics'

trackPlayer(detectPlayer(), { app: 'timer' })
```

**Reported by the client, profiled wherever the signal is richest.** Reporting is always
client-side so GA4 attributes the hit to the screen's own `client_id`, and because the SSR
apps cache their HTML on a key with no user-agent component — a profile baked into that
HTML would describe whichever screen missed the cache.

The profile itself is better server-side. Only a request carries `X-Requested-With`, and
for yodeck / pisignage / xogo / iadea / ablesign / harison / zoom / google-meet that header
is the **only** thing that names the vendor; their user agents say nothing but
"Android Webview" (a large unattributable bucket). So Worker apps mount
`./analytics-server`, which serves the live request's profile `no-store`, and the page
reports that instead:

```ts
// Worker: mount the route (exclude it from the page cache)
import { PLAYER_PROFILE_PATH, playerProfileResponse } from '@screenly-labs/signage-kit/analytics-server'
app.get(PLAYER_PROFILE_PATH, (c) => playerProfileResponse(c.req.raw, { app: 'weather' }))
```

Pass `app` and the payload gains a ready-made `userProperties` object, which the inline
bootstrap sets **before** it calls `config`. Without it the automatic `page_view` goes out
ahead of `trackPlayer` and carries no player fields, so the first page view under any
`client_id` is unattributed. On a player that starts each load with fresh storage that is
every page view it ever sends: `player_vendor=yodeck` measured 150 users and **zero** page
views on 2026-08-14, and 21% of all app runs carried no player fields.

**A static app has no server**, so it cannot know the player before `config` fires. It
suppresses GA4's automatic page view and fires it from `trackPlayer` instead, one line after
the user properties:

```html
<!-- index.html: paired with sendPageView below. Never set one without the other. -->
<script>gtag('config', 'G-XXXXXXX', { send_page_view: false })</script>
```

```ts
trackPlayer(detectPlayer(), { app: 'quotes', sendPageView: true })
```

The two options pair: set one without the other and the app either double-counts every page
view or stops counting them. The trade is that a load which never reaches `main.js` now
reports nothing instead of an unattributed page view. That is 0.3% or less of loads on every
static app, measured, against 68% of their page views carrying no player fields before. On
Weather the same gap is 1.7%, which is why the Worker apps keep the automatic page view
and use the `app` option above instead.

`player_sources` records which signals were available, so a report can tell an enriched
row from a user-agent-only one rather than silently mixing them.

**Scope: user, not event.** A device's vendor/model/engine never changes, so these go out as
**user properties** and attach to every event the screen sends after they are set. That is
what makes "everything from BrightSign players" a filter on any report instead of one that
only works on the event carrying the params. A `player_detected` event carries the same
values so there is a countable occurrence and a numeric `player_engine_version` GA4 can
average.

**It does not make `totalUsers` per vendor a device census.** This document used to claim it
did, and that was wrong. GA4's `client_id` lives in the `_ga` cookie and these players
largely boot with fresh storage, so ids churn constantly, and the churn rate differs between
players by two orders of magnitude: a vendor's share of `totalUsers` mostly reflects how it
handles storage. Report absolute figures as app runs, and use `player_device` where real
device identity is available.

### The GA4 schema

Sending a param is only half the job: until a matching **custom dimension** exists in the
property, GA4 stores the value but no report can see it. The schema is therefore checked
in as data, in `./analytics-schema`, rather than living only in 16 admin screens:

| parameter | scope | what it answers |
|---|---|---|
| `player_vendor` | USER | which vendor (`brightsign`, `anthias`, `yodeck`, ... or `unknown`) |
| `player_platform` | USER | `linux-arm`, `raspberry-pi`, `tizen`, `webos`, `firetv`, `linux`, ... |
| `player_model` | USER | model from the UA. Free-form, so the cardinality risk |
| `player_category` | USER | `signage` / `meeting-room` / `browser` / `bot` — exclude non-players |
| `player_engine` | USER | `qtwebengine`, `chromium`, `webkit`, ... |
| `player_engine_version` | USER | version as a string, for segmenting |
| `player_below_floor` | USER | `true` / `false` / `unknown` against the support floor |
| `player_confidence` | USER | `high` / `medium` / `low` — filter to high to trust a split |
| `player_sources` | USER | which signals were available; `requestedWith` marks a Worker-enriched row |
| `player_app` | USER | which app reported, so a blended report stays readable |
| `player_degraded` | USER | `true` / `false` / `unknown` — **measured**, is this screen on the degraded path |
| `player_degraded_reason` | USER | `none` / `old` / `slow` / `old+slow` / `probe-failed` |
| `player_css_support` | USER | measured CSS features, sorted and `+` joined: `is`, `layers`, `has`, `container` |
| `player_device` | USER | hashed stable Screenly device id. High cardinality, see below |
| `player_sw_version` | USER | Screenly player generation (`v2`), NOT an engine version |
| `player_metadata` | USER | was Screenly asset metadata present on the request |
| `player_engine_version` | EVENT **metric** | same param as a number, so GA4 can average it |

### `totalUsers` is not a device count

GA4's `client_id` lives in the `_ga` cookie and these players largely boot with fresh storage.
Measured over a week, almost no `client_id` survived a single day and nearly every user looked
brand new. A multi-day window therefore inflates by roughly its length.

Worse for comparisons, the churn rate differs sharply between players: one can mint a fresh id
on nearly every page load while another keeps one across many. A player's
apparent share of `totalUsers` therefore mostly reflects how it handles storage.

So: never compare `totalUsers` across vendors, and report absolute figures as **app runs**.

**`client_id` is pinned to the device** by `./analytics-bootstrap`, which is what makes GA4's own
unique identifier stable for a screen instead of churning. It is an inline `<head>` snippet rather
than part of the app bundle for two reasons: `client_id` is stamped onto every event as it is sent,
so `config` has to wait for the device id and therefore has to own the call; and a share of screens
fire a `page_view` and never load the bundle, so moving `config` there would turn a counting fix
into a data loss. It cannot be rendered into the HTML either, because that HTML is edge-cached with
no per-screen component, so every screen would inherit whichever one warmed the cache. Every path
ends in exactly one `config` call, including a timeout, so a stalled fetch can never leave a screen
silent.

`player_device` is the fix, where it is available. It comes from `X-Screenly-hostname`, an actual
Screenly device id (`srly-jmar75ko6xp651j`), hashed to 128 bits before it leaves the Worker so
GA4 never holds a joinable key into device inventory. Two limits: only the 5 Worker apps can read
request headers, and `send_metadata` defaults to **false** on the asset, so coverage is a subset.
`player_metadata` measures that subset. Being high cardinality, GA4 buckets the tail into
`(other)`, so treat `player_device` as a calibration sample (views per device) rather than a
census.

A **fingerprint** is not an alternative. Signage fleets are deliberately identical: whole
populations here share one frozen browser image, and the dominant player UA carries no version
token at all. Canvas, WebGL, audio, fonts and
resolution are identical across identical hardware, so a fingerprint-derived id would merge
thousands of screens into one. Today's over-count is detectable; a colliding fingerprint
under-counts silently.

### Measured capability, and why it exists alongside `player_below_floor`

`player_below_floor` is read off the UA version, and that fails completely on the largest
fleet in the census: the Screenly v1 viewer sends no version token, so the field was
`unknown` for the large majority of attributable screens, so the fleet had no floor signal.

A probe cannot fix that by restating the floor. `FLOOR` is `chrome >= 87, firefox >= 78,
safari >= 14.1` and no cross-engine API lands on exactly those versions, so `./capability`
reports two things that are exact instead:

- **`player_degraded`** is the degraded gate's own predicate, re-run at report time. Exact by
  construction, and populated on every screen with a DOM.
- **`player_css_support`** is a **set**, not a tier, because the versions are not monotonic
  across engines: Firefox shipped container queries in 110 and `:has()` only in 121. `layers`
  is the one with a decision attached, since `build.js` rewrites `@layer` into `:not(#\#)`
  specificity hacks for engines below Chromium 99, and that rewrite is a standing tax on
  every Tailwind app's CSS.

`player_below_floor` is deliberately left alone rather than repurposed. GA4 registration is
not retroactive, so changing a live dimension's meaning would make every historical row
silently incomparable, and keeping both allows the probe to be cross-checked against the UA
verdict on the screens where both exist.

The measurement happens in the kit rather than by reading `html.legacy`, because the gate is
inlined into HTML that is cached (a 12h SSR page cache on the Worker apps, build-time
injection on the static ones) while `main.js` turns over on deploy. It is also the only
option for the Worker apps, whose profile is built server-side where there is nothing to
feature-detect. `test/capability.test.ts` executes the real `GATE` string against the same
synthetic environments to keep the two copies of the predicate from drifting.

`trackPlayer()` does the probing itself, so an app picks all three fields up from a version
bump with no code change.

`player_engine_version` appears twice on purpose. Dimensions and metrics are separate
namespaces, so the USER dimension segments devices ("everything on Chromium 69") while
the event-scoped metric lets GA4 average the version across a population.

A test asserts these parameter names are **exactly** the keys `playerUserProperties`
emits. Add a telemetry field without adding it here and the build fails, rather than GA4
quietly collecting into a dimension nobody registered.

Register them once per property (they are per-property, and not retroactive, so do it
before the app ships):

```bash
# POST /v1beta/properties/<id>/customDimensions   scope USER
# POST /v1beta/properties/<id>/customMetrics      scope EVENT, measurementUnit STANDARD
```

Two GA4 settings worth checking at the same time, because neither is retroactive:

* **Event data retention** defaults to 2 months. A player census wants the maximum, which
  is 14 months on a standard property (26/38/50 need 360).
* **BigQuery export** is the only way to recover params collected *before* their dimension
  existed. Without it, anything sent before registration is unreportable.

Watch the caps, which differ by scope: a user property value is **36 chars** (an event
param is 100) and a user property name is **24** (a param is 40). `player_model` is the
only free-form value, so it is the one that gets clamped, and the highest-cardinality
field to watch in reports.

## Supported resolutions

Every app must render correctly across this matrix (single source of truth; see
`Playground/docs/resolutions.md`), in **both orientations**, fluid across the whole
480px → 4K range — the fluid root is orientation-neutral, so there are no pixel
breakpoints, only orientation/aspect-ratio media queries where a layout needs them.

| Resolution | Orientation | Notes |
| --- | --- | --- |
| 4096×2160 / 3840×2160 | landscape | 4K |
| 2160×4096 / 2160×3840 | portrait | 4K |
| 1920×1080 / 1080×1920 | both | 1080p |
| 1280×720 / 720×1280 | both | 720p |
| 800×480 / 480×800 | both | Raspberry Pi Touch Display |

Canonical viewport tag (use verbatim in every app's `<head>`):

```html
<meta name="viewport" content="width=device-width, initial-scale=1" />
```

## Gotchas

1. **Keep `@import 'tailwindcss'` in the app**, before the preset. Tailwind resolves
   that import relative to the importing repo, and this package's directory has no
   `tailwindcss`.
2. **TypeScript consumers** rely on the shipped `.d.ts` files and the `types` export
   condition (`moduleResolution: bundler`/`node16`). After bumping the package, run
   `bun install` so the resolved metadata refreshes.

## Versioning

CalVer, `YYYY.M.MICRO` (e.g. `2026.7.0`) — month with no zero-padding so it stays
a valid semver string, and `MICRO` counts releases within the month (resets each
month). Apps pin to a tag: `github:Screenly-Labs/signage-kit#2026.7.0`.

**Bump `package.json` `version` in the release commit, before tagging.**
`.github/workflows/release.yml` refuses to publish when the tag and the
`package.json` version disagree, so a tag pushed without the bump leaves a red
Release run and nothing in GitHub Packages, while apps pinning that git tag still
resolve it and look fine. That mismatch is invisible from the app side, which is
exactly what makes it worth stating here.

## Develop

```sh
bun install
bun run typecheck && bun run lint && bun test
```
