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
// The shared signage hygiene (no scrollbar, no text selection on touch panels,
// font smoothing, .text-legible). Tailwind apps pull the same sheet in through the
// preset's @import; raw-CSS apps get it prepended here, so both paths share one
// definition instead of drifting.
const SIGNAGE_RESET_CSS = readFileSync(new URL('../styles/signage-reset.css', import.meta.url), 'utf8')

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
  const out = html.replace(/([ \t]*)(<link rel="stylesheet")/, `$1${GATE}\n$1$2`)
  // Fail loud: a silent no-op would ship a page that never sets html.legacy on
  // old/weak players. The gate must land before the first stylesheet.
  if (out === html) {
    throw new Error('injectGate: no `<link rel="stylesheet">` found to inject the degraded-mode gate before')
  }
  return out
}

// The font URL prefix baked into styles/fonts.css. Absolute from the document
// root, which is correct for an app served at the root and wrong for anything
// served from a subpath — see the fontPath option on processCss.
export const FONT_URL_PREFIX = '/static/fonts/'

// Rewrite the vendored-font prefix in url() tokens. Scoped to url() rather than a
// blanket string replace so a font *name* or a comment containing the same text is
// left alone.
const rewriteFontUrls = (css, fontPath) => {
  const base = fontPath === '' || fontPath.endsWith('/') ? fontPath : `${fontPath}/`
  return css.replace(
    /url\((\s*['"]?)\/static\/fonts\//g,
    (_match, quote) => `url(${quote}${base}`
  )
}

// Down-level + minify CSS to the FLOOR.
//   flattenLayers  – Tailwind output: rewrite @layer into :not(#\#) specificity
//                    (Lightning CSS won't unwrap it, and engines below the @layer
//                    floor drop layered rules wholesale).
//   includeDegraded – raw-CSS apps: prepend the shared unlayered base, i.e. the
//                    html.legacy kill-switch AND the signage reset, both of which
//                    Tailwind apps instead get via the preset's @import.
//   fontPath        – rewrite styles/fonts.css's `/static/fonts/` prefix. The
//                    default is correct for an app served at the document root,
//                    but a consumer served from a subpath (a WordPress plugin under
//                    /wp-content/plugins/<slug>/, a project page under /<repo>/)
//                    gets a 404 for every face. Pass the prefix the built
//                    stylesheet should use — relative values resolve against the
//                    stylesheet, so 'fonts/' is usually what you want, and it pairs
//                    with the destDir you gave syncFonts(). Without this an app has
//                    to hand-maintain its own @font-face block and the kit stops
//                    owning which files ship.
export async function processCss(
  cssText,
  { flattenLayers = false, includeDegraded = false, filename = 'main.css', fontPath } = {}
) {
  let css = includeDegraded ? `${DEGRADED_CSS}\n${SIGNAGE_RESET_CSS}\n${cssText}` : cssText
  if (typeof fontPath === 'string') {
    css = rewriteFontUrls(css, fontPath)
  }
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
// allowOverwrite lets the output path equal the entry path, so Worker apps that
// serve the client in place (clock-app, weather-app: source == served file) can
// bundle over their own entry, matching the apps' original inlined esbuild.
export async function bundleJs(entry, outfile, { format = 'iife' } = {}) {
  await esbuild({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format,
    target: ['es2017'],
    outfile,
    allowOverwrite: true
  })
}
