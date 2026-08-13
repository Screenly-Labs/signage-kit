// What this screen can actually DO, measured in the browser, as opposed to what its user
// agent claims. This is the answer to the biggest hole in the UA-derived telemetry.
//
// `./profiler` reads the support floor off the UA version, which fails completely on the
// single largest fleet in the census: the Screenly v1 viewer sends no version token at all
// (`...AppleWebKit/537.36 (KHTML, like Gecko) screenly-viewer Safari/537.36`), so
// `belowFloor` came back null for the large majority of screens we can attribute, so the
// field did not do its job.
//
// A probe cannot fix that by imitating the floor. FLOOR is `chrome >= 87, firefox >= 78,
// safari >= 14.1` (see ./build.js) and no cross-engine API lands on exactly those versions,
// so any probe is a version or so off. So this module deliberately does NOT try to restate
// the floor. It reports two things that are exact instead:
//
//   1. The gate's own verdict. ./gate.js already decides whether a screen gets the degraded
//      CSS path, and that decision, not a version number, is what we operationally care
//      about. Reporting the gate's predicate is exact by construction.
//   2. Which of the CSS features the build has to work around are actually supported.
//
// MEASURED IN THE KIT, NOT READ OFF `html.legacy`.
//
// The gate is inlined into HTML, and that HTML is cached: the Worker apps hold a 12h SSR
// page cache and the static apps bake the gate into index.html at build time. So a gate
// change reaches screens only as their HTML re-renders. `main.js` is a versioned asset that
// turns over on deploy, so re-running the probes here covers every screen as soon as the kit
// ships. It also fixes a case the gate cannot help with: the Worker apps report a profile
// built on the SERVER, where feature detection is impossible by definition.
//
// The cost is a second copy of the gate's predicate, so test/capability.test.ts executes the
// GATE string itself against the same synthetic environments and asserts the two agree. Same
// guard as ./analytics-schema uses against GA4 drift.

/**
 * Why a screen is on the degraded path.
 *
 * `probe-failed` mirrors the gate's `catch`: when the probes throw, the gate degrades
 * defensively rather than assuming the screen is fine, and it cannot say which check would
 * have fired. Kept as its own value so those screens stay countable instead of being
 * folded into `old`.
 */
export type DegradedReason = 'none' | 'old' | 'slow' | 'old+slow' | 'probe-failed'

/** The CSS features the build currently has to accommodate. */
export type CssFeature = 'is' | 'layers' | 'has' | 'container'

export interface Capability {
  /** `true` when this screen gets the degraded path. `null` when there is no DOM to probe. */
  degraded: boolean | null
  reason: DegradedReason | null
  /** Supported features, sorted. Empty when none are, `null` when there is no DOM. */
  css: CssFeature[] | null
}

/** Minimal shape of the globals the probes touch, so a Worker or a test can pass stubs. */
export interface ProbeWindow {
  Element?: { prototype: object } | undefined
  navigator?: { deviceMemory?: number; hardwareConcurrency?: number } | undefined
  CSS?: { supports?: (value: string) => boolean } | undefined
  CSSLayerBlockRule?: unknown
}

/**
 * `replaceChildren` is a 2020-era DOM API and is the gate's own staleness check. It is one
 * Chromium version more permissive than FLOOR (86 against 87), which is exactly why this
 * module reports "is this screen degraded" rather than claiming to restate the floor.
 */
const isOldEngine = (win: ProbeWindow): boolean =>
  !(win.Element && 'replaceChildren' in win.Element.prototype)

/**
 * Weak hardware, by the gate's thresholds. Both readings are Chromium-only and absent
 * elsewhere, and the `&&` matters: a missing value must not read as 0 and condemn every
 * screen that does not implement the API.
 */
const isSlowHardware = (win: ProbeWindow): boolean => {
  const nav = win.navigator
  if (!nav) return false
  return (
    (!!nav.deviceMemory && nav.deviceMemory <= 2) ||
    (!!nav.hardwareConcurrency && nav.hardwareConcurrency <= 2)
  )
}

/**
 * The CSS features worth counting, each with the versions it landed in, verified against the
 * caniuse-lite data already in this repo rather than from memory:
 *
 *   is         chrome 88  firefox 78   safari 14     — closest marker to FLOOR itself
 *   layers     chrome 99  firefox 97   safari 15.4   — why build.js flattens @layer
 *   has        chrome 105 firefox 121  safari 15.4
 *   container  chrome 106 firefox 110  safari 16
 *
 * Reported as a SET rather than a tier ladder, deliberately. The versions are not monotonic
 * across engines: Firefox shipped container queries in 110 and `:has()` only in 121, so a
 * Firefox 115 screen supports a "higher" feature than a "lower" one and any single
 * highest-tier-passed value would be a lie about the others. A sorted set is exact, and its
 * cardinality is at most 16 rows.
 *
 * `layers` is the one with a decision attached: build.js rewrites `@layer` into `:not(#\#)`
 * specificity hacks because engines below Chromium 99 drop layered rules wholesale, and that
 * rewrite is a standing tax on every Tailwind app's CSS. This is the number that says when it
 * can go.
 *
 * `CSS.supports('selector(...)')` returns false where `selector()` itself is unsupported, so
 * the probes fail toward "old", which is the safe direction.
 */
const CSS_PROBES: ReadonlyArray<readonly [CssFeature, (win: ProbeWindow) => boolean]> = [
  ['is', (win) => win.CSS?.supports?.('selector(:is(a))') === true],
  // Tested by VALUE, not with `in`. An engine without cascade layers has no such global at
  // all, so both work in a browser, but `in` is true for a key that merely exists holding
  // undefined, which makes it fragile the moment anything constructs a window-like object.
  ['layers', (win) => win.CSSLayerBlockRule != null],
  ['has', (win) => win.CSS?.supports?.('selector(:has(a))') === true],
  ['container', (win) => win.CSS?.supports?.('container-type: inline-size') === true]
]

const reasonFor = (old: boolean, slow: boolean): DegradedReason => {
  if (old && slow) return 'old+slow'
  if (old) return 'old'
  if (slow) return 'slow'
  return 'none'
}

/**
 * Probe the current screen. Pass a stub for tests or leave it to read the real globals.
 *
 * Returns all-null when there is no `window` to probe (SSR, a Worker, a test runner without
 * a DOM). That is reported as `unknown` rather than guessed, because "we could not look" and
 * "we looked and the screen is fine" must not land in the same bucket.
 */
export const detectCapability = (
  win: ProbeWindow | undefined = typeof window !== 'undefined'
    ? (window as unknown as ProbeWindow)
    : undefined
): Capability => {
  if (!win) return { degraded: null, reason: null, css: null }
  try {
    const old = isOldEngine(win)
    const slow = isSlowHardware(win)
    // Probed independently of `degraded`: a screen can be on the degraded path for weak
    // hardware while still supporting every modern feature, and that is worth seeing.
    const css = CSS_PROBES.filter(([, probe]) => probe(win)).map(([name]) => name)
    return { degraded: old || slow, reason: reasonFor(old, slow), css }
  } catch {
    // Matches the gate: on a throw it adds `legacy` rather than assuming the screen copes.
    return { degraded: true, reason: 'probe-failed', css: null }
  }
}
