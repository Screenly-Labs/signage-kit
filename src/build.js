// Shared build pipeline for the Screenly-Labs signage apps.
//
// This is the piece that pays for the package: the browser-support FLOOR and the
// down-leveling recipe live here ONCE. During the degraded-mode rollout the same
// change had to be made across ~15 repos and re-fixed three more times (the floor
// bumped 65 -> 79 -> 87, plus the gate/polyfill fixes). Building through these
// helpers turns each of those into a one-line change here.

import { readFileSync } from 'node:fs'
import browserslist from 'browserslist'
import { build as esbuild } from 'esbuild'
import { browserslistToTargets, transform as lightningcss } from 'lightningcss'
import { GATE } from './gate.js'

// Re-export the gate so build code can `import { GATE } from '.../build'` too.
export { GATE }

// The shared degraded-mode kill-switch, read once. Tailwind apps pull it in via
// the preset's @import; raw-CSS apps (Workers, world-clock) inject it through
// processCss({ includeDegraded: true }) since they have no @import resolution.
const DEGRADED_CSS = readFileSync(new URL('../styles/degraded.css', import.meta.url), 'utf8')

// The single support floor for the whole fleet. Chrome 87 / Safari 14.1 is the
// honest minimum where the apps' modern CSS renders natively: clamp()/min()/max()
// (Chrome 79 / Safari 11.1) AND logical properties like inset-inline-end
// (Chrome 87 / Safari 14.1). Lightning CSS can't safely lower logical properties
// below that (it emits :lang()-guarded selectors old engines drop), and it can't
// polyfill clamp. Above the floor, @layer / svh / cqw / color-mix are still
// down-leveled or fall back per-app. Change the floor HERE, once.
export const FLOOR = ['chrome >= 87', 'firefox >= 78', 'safari >= 14.1', 'edge >= 87']

const TARGETS = browserslistToTargets(browserslist(FLOOR))

// Insert the gate immediately before the first stylesheet <link> so it runs before
// first paint (for apps with a built index.html). Returns the modified HTML.
export function injectGate(html) {
  return html.replace(/([ \t]*)(<link rel="stylesheet")/, `$1${GATE}\n$1$2`)
}

// Down-level + minify CSS to the FLOOR.
//   flattenLayers  – Tailwind output: rewrite @layer into :not(#\#) specificity
//                    (Lightning CSS won't unwrap it, and engines below the @layer
//                    floor drop layered rules wholesale).
//   includeDegraded – raw-CSS apps: prepend the shared html.legacy kill-switch,
//                    which Tailwind apps instead get via the preset's @import.
export async function processCss(
  cssText,
  { flattenLayers = false, includeDegraded = false, filename = 'main.css' } = {}
) {
  let css = includeDegraded ? `${DEGRADED_CSS}\n${cssText}` : cssText
  if (flattenLayers) {
    // postcss + the cascade-layers plugin are only needed to flatten Tailwind's
    // @layer output, so they're optional peers loaded on demand — raw-CSS apps
    // (Workers, world-clock) never pull them in.
    const [{ default: postcss }, { default: cascadeLayers }] = await Promise.all([
      import('postcss'),
      import('@csstools/postcss-cascade-layers')
    ])
    css = (await postcss([cascadeLayers()]).process(css, { from: filename })).css
  }
  const { code } = lightningcss({ filename, code: Buffer.from(css), minify: true, targets: TARGETS })
  return code
}

// Bundle a browser entry into one self-contained script at the FLOOR's syntax
// level. Default 'iife' keeps it an export-free classic script; pass format:'esm'
// for apps that load it as <script type="module"> (e.g. world-clock).
export async function bundleJs(entry, outfile, { format = 'iife' } = {}) {
  await esbuild({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format,
    target: ['es2017'],
    outfile
  })
}
