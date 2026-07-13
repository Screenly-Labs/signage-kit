# @screenly-labs/signage-kit

Shared build pipeline, degraded-mode layer, and base Tailwind preset for the
Screenly-Labs signage apps. It exists to DRY up the parts that were copy-pasted
across ~15 app repos (and had to be re-fixed several times): the browser-support
**floor**, the CSS down-leveling recipe, the JS bundler, the degraded-mode
**gate**, the `replaceChildren` **shim**, and the `html.legacy` **kill-switch**.

The apps keep their own **design identity** — palette, display fonts, layout,
signature element. Only the plumbing and the brand chrome are shared.

## Install

```sh
bun add @screenly-labs/signage-kit
# peers (already present in the apps): esbuild lightningcss browserslist postcss @csstools/postcss-cascade-layers
```

## What it provides

| Export | Use |
| --- | --- |
| `@screenly-labs/signage-kit/build` | `FLOOR`, `GATE`, `injectGate`, `processCss`, `bundleJs` — the build-time pipeline |
| `@screenly-labs/signage-kit/gate` | `GATE` only, with **no build deps** — safe to import from a Worker SSR template |
| `@screenly-labs/signage-kit/polyfills` | the `replaceChildren` shim (import for side effect, first line of your entry) |
| `@screenly-labs/signage-kit/styles/preset.css` | base Tailwind layer: brand token, fluid root, resets, `svh` fallback, the degraded layer |
| `@screenly-labs/signage-kit/styles/degraded.css` | just the `html.legacy` kill-switch |

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

## Gotchas

1. **Keep `@import 'tailwindcss'` in the app**, before the preset. Tailwind resolves
   that import relative to the importing repo, and this package's directory has no
   `tailwindcss`.
2. **TypeScript consumers** rely on the shipped `.d.ts` files and the `types` export
   condition (`moduleResolution: bundler`/`node16`). After bumping the package, run
   `bun install` so the resolved metadata refreshes.

## Develop

```sh
bun install
bun run typecheck && bun run lint && bun test
```
