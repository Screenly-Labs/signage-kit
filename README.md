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
| `@screenly-labs/signage-kit/profiler` | `detectPlayer()`, `vendorFromPackage()` — identify which player/device a request comes from |
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
//   category: 'signage' | 'meeting-room' | 'browser' | 'bot',
//   confidence: 'high' | 'medium' | 'low',
//   sources: ['userAgent', 'referrer'] }
```

Called with no arguments in the browser it reads the globals (safe when absent — SSR /
Workers just get `''`). Two things page JS **cannot** see are worth knowing:

- **Request headers are not exposed to page JS.** The `X-Requested-With` package is a
  third, optional argument for server-side callers (a Worker/SSR that has the header):
  `detectPlayer(ua, referer, requestedWith)`. `vendorFromPackage(pkg)` maps a package on
  its own. At runtime the profiler works from UA + referrer only.

  On the server, use `detectPlayerFromRequest(request)` — it reads `User-Agent`, `Referer`,
  and `X-Requested-With` off the request and factors in whichever are present, so the
  Worker apps (e.g. `weather`, `clock`) get the full three-signal profile while a static
  app just gets UA + referrer. Prefer it over the no-arg form on a Worker, where the
  `navigator`/`document` globals describe the runtime (`navigator.userAgent` is
  `"Cloudflare-Workers"`), not the visitor.

  ```ts
  import { detectPlayerFromRequest } from '@screenly-labs/signage-kit/profiler'
  // Cloudflare Worker / Hono
  export default { fetch: (req: Request) => { const player = detectPlayerFromRequest(req); /* … */ } }
  ```
- **Referrers to the app's own `*.srly.io` hosts identify the *content*, not the player,**
  so they're ignored. Referrer's value is recovering players the UA hides — e.g.
  `player.yodeck.com` (Yodeck buried in a generic Fire TV UA) or `pisignage.com` (piSignage
  sends no UA token at all).

Notes baked into the classifier: **Anthias** is only claimed on the explicit `Anthias/`
UA token — the large bare-`QtWebEngine` bucket is the same engine but is reported as
`{ vendor: null, category: 'signage', confidence: 'low' }`, never attributed to Anthias.
**Screenly** detection is the original `screenly-viewer` check, enriched to also match
`ScreenlyWebview` and `screenly-viewer/2.0`; `isScreenlyPlayer()` from `./branding` now
delegates here, so the two never drift.

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
