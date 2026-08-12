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
| `@screenly-labs/signage-kit/build` | `FLOOR`, `GATE`, `injectGate`, `processCss`, `bundleJs` — the build-time pipeline |
| `@screenly-labs/signage-kit/gate` | `GATE` only, with **no build deps** — safe to import from a Worker SSR template |
| `@screenly-labs/signage-kit/polyfills` | the `replaceChildren` shim (import for side effect, first line of your entry) |
| `@screenly-labs/signage-kit/branding` | `isScreenlyPlayer()`, `removeScreenlyBranding()` — hide the promo badge on Screenly players |
| `@screenly-labs/signage-kit/profiler` | `detectPlayer()`, `detectPlayerFromRequest()`, `vendorFromPackage()` — identify which player/device a request comes from |
| `@screenly-labs/signage-kit/analytics` | `trackPlayer()` — report the player profile to GA4 as user properties + a `player_detected` event |
| `@screenly-labs/signage-kit/analytics-server` | `playerProfileResponse()` — Worker route serving the live request's profile `no-store`, for the header-enriched vendors |
| `@screenly-labs/signage-kit/analytics-schema` | `PLAYER_DIMENSIONS`, `PLAYER_METRICS` — the GA4 custom dimensions/metrics to register, as data |
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

## Player telemetry (GA4)

`./analytics` turns a `PlayerProfile` into the shape GA4 can report on, so every app
answers one question the same way: **which players are showing this app?**

GA4's own device dimensions cannot answer it. In a 90-day sample of one app, 380,999 of
401,790 devices reported as `Safari / Linux / smart tv` with `deviceModel` "(not set)",
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
"Android Webview" (12,289 devices in that sample). So Worker apps mount
`./analytics-server`, which serves the live request's profile `no-store`, and the page
reports that instead:

```ts
// Worker: mount the route (exclude it from the page cache)
import { PLAYER_PROFILE_PATH, playerProfileResponse } from '@screenly-labs/signage-kit/analytics-server'
app.get(PLAYER_PROFILE_PATH, (c) => playerProfileResponse(c.req.raw))
```

`player_sources` records which signals were available, so a report can tell an enriched
row from a user-agent-only one rather than silently mixing them.

**Scope: user, not event.** On an unattended screen one GA4 user is one device, and a
device's vendor/model/engine never changes, so these go out as **user properties** and
attach to every event the screen ever sends. That is what makes "everything from
BrightSign players" a filter on any report instead of one that only works on the event
carrying the params, and it makes `totalUsers` per vendor a device census directly. A
`player_detected` event carries the same values so there is a countable occurrence and a
numeric `player_engine_version` GA4 can average.

### The GA4 schema

Sending a param is only half the job: until a matching **custom dimension** exists in the
property, GA4 stores the value but no report can see it. The schema is therefore checked
in as data, in `./analytics-schema`, rather than living only in 16 admin screens:

| parameter | scope | what it answers |
|---|---|---|
| `player_vendor` | USER | which vendor (`brightsign`, `anthias`, `yodeck`, ... or `unknown`) |
| `player_platform` | USER | `raspberry-pi`, `tizen`, `webos`, `firetv`, `linux`, ... |
| `player_model` | USER | model from the UA. Free-form, so the cardinality risk |
| `player_category` | USER | `signage` / `meeting-room` / `browser` / `bot` — exclude non-players |
| `player_engine` | USER | `qtwebengine`, `chromium`, `webkit`, ... |
| `player_engine_version` | USER | version as a string, for segmenting |
| `player_below_floor` | USER | `true` / `false` / `unknown` against the support floor |
| `player_confidence` | USER | `high` / `medium` / `low` — filter to high to trust a split |
| `player_sources` | USER | which signals were available; `requestedWith` marks a Worker-enriched row |
| `player_app` | USER | which app reported, so a blended report stays readable |
| `player_engine_version` | EVENT **metric** | same param as a number, so GA4 can average it |

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

## Develop

```sh
bun install
bun run typecheck && bun run lint && bun test
```
