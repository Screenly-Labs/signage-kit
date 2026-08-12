// GA4 player telemetry. Turns the PlayerProfile from ./profiler into the shape GA4
// can actually report on, so every signage app answers one question uniformly:
// which players are showing this app, and what are they?
//
// Why this exists: GA4's own device detection is useless for signage. Across a
// 90-day sample of one app, 380,999 of 401,790 devices reported as
// `Safari / Linux / smart tv` with `deviceModel` "(not set)" — a single
// undifferentiated blob, because a QtWebEngine player looks like Safari to GA's
// UA parser. Nothing in the standard dimensions separates a BrightSign from an
// Anthias from a generic panel. The profiler can; this module ships what it finds.
//
// REPORTED BY THE CLIENT, PROFILED WHEREVER THE SIGNAL IS RICHEST.
//
// Reporting is always client-side, so GA4 attributes the hit to the screen's own
// client_id. It must NOT be reported from the server off a cached response: the SSR
// apps cache their HTML at the edge on a key with no user-agent component, so a
// profile baked into that HTML would describe whichever player missed the cache and
// then be served to every screen that hit it afterwards.
//
// But the profile itself is strictly better server-side. Only a request carries
// `X-Requested-With`, the Android WebView package name, and for a whole class of
// players that header is the ONLY way to name the vendor: yodeck, pisignage, xogo,
// iadea, ablesign, harison, zoom and google-meet all ship as Android WebViews whose
// user agent says nothing but "Android Webview". In the 90-day sample that bucket was
// 12,289 devices, all currently unattributable.
//
// So the Worker apps profile the live request (see ./analytics-server, which serves it
// uncached) and hand that profile to `trackPlayer`; the static apps pass the
// `detectPlayer()` profile they can build in the browser. `player_sources` records
// which signals were actually available, so a report can tell an enriched row from a
// user-agent-only one instead of silently mixing them.

import type { PlayerProfile } from './profiler'

/**
 * GA4 has neither null nor boolean in a value. An absent param simply makes the
 * dimension read "(not set)", which is indistinguishable from "we never registered
 * this dimension". Sending an explicit sentinel keeps "we looked and could not tell"
 * as its own countable bucket.
 */
export const UNKNOWN = 'unknown'

/** Fired once per page load, after the user properties are set. */
export const PLAYER_EVENT = 'player_detected'

/**
 * GA4 length caps, which differ by scope and are the reason this module has two
 * formatters rather than one:
 *   * event param value: 100 chars
 *   * user property value: 36 chars  <- much tighter, and `model` can exceed it
 * Names are also capped (40 for a param, 24 for a user property); every name below
 * is inside both, deliberately.
 */
const MAX_EVENT_VALUE = 100
const MAX_USER_VALUE = 36

const clamp = (value: unknown, max: number): string =>
  value == null ? UNKNOWN : String(value).slice(0, max)

/** `null` becomes the sentinel; `true`/`false` become their own strings. */
const flag = (value: boolean | null): string => (value == null ? UNKNOWN : String(value))

/**
 * The contributing signals as one stable value. Sorted so `userAgent+referrer` and
 * `referrer+userAgent` are the same row rather than two, and joined with `+` because a
 * comma reads as a list separator in the GA4 UI. At most three signals exist, so the
 * cardinality here is tiny.
 */
const sources = (profile: PlayerProfile): string =>
  profile.sources?.length ? [...profile.sources].sort().join('+') : UNKNOWN

/** The telemetry fields, flat. Keys double as the GA4 custom-dimension parameter names. */
export interface PlayerTelemetry {
  player_app: string
  player_vendor: string
  player_platform: string
  player_model: string
  player_category: string
  player_engine: string
  player_engine_version: string
  player_below_floor: string
  player_confidence: string
  player_sources: string
}

/**
 * The device attributes as GA4 **user properties**.
 *
 * User scope, not event scope, is the whole point. On an unattended screen one GA4
 * user is one device, and a device's vendor/model/engine never changes, so at user
 * scope these attach to *every* event the screen ever sends. That is what makes
 * "show me everything from BrightSign players" a filter on any report, rather than a
 * filter that only works on the one event that happened to carry the params. It also
 * makes `totalUsers` per vendor a device census directly.
 *
 * `player_sources` is the provenance of the row: `userAgent+referrer` is a browser-only
 * profile, and the presence of `requestedWith` marks one enriched by a Worker off the
 * live request headers. Without it, an unattributed Android WebView from a static app
 * would be indistinguishable from one a Worker looked at and still could not name.
 */
export const playerUserProperties = (profile: PlayerProfile, app: string): PlayerTelemetry => ({
  // Each app reports into its own GA4 property, so this is redundant within a single
  // property. It is here so a blended report across all of them stays self-describing,
  // and so the data survives if the properties are ever consolidated.
  player_app: clamp(app, MAX_USER_VALUE),
  player_vendor: clamp(profile.vendor, MAX_USER_VALUE),
  player_platform: clamp(profile.platform, MAX_USER_VALUE),
  // The only free-form value: parsed straight out of a UA, so it is both the longest
  // and the highest-cardinality field. Clamped hardest by the 36-char user cap.
  player_model: clamp(profile.model, MAX_USER_VALUE),
  player_category: clamp(profile.category, MAX_USER_VALUE),
  player_engine: clamp(profile.engine?.name, MAX_USER_VALUE),
  // A user property value is always a string, so the version is stringified here. The
  // numeric form is kept on the event params below, where GA4 can average it.
  player_engine_version: clamp(profile.engine?.version, MAX_USER_VALUE),
  player_below_floor: flag(profile.belowFloor),
  player_confidence: clamp(profile.confidence, MAX_USER_VALUE),
  player_sources: sources(profile)
})

/**
 * The same profile as event params, for the `player_detected` event. Kept alongside
 * the user properties so there is a countable "we profiled this screen" occurrence
 * (and something visible in Realtime/DebugView while wiring an app up), and so
 * `player_engine_version` arrives as a real number.
 *
 * `extra` is for a judgement an individual app makes that the kit should not own, for
 * example clock-app's "is this a stale Anthias?" flag.
 */
export const playerEventParams = (
  profile: PlayerProfile,
  app: string,
  extra: Record<string, string | number> = {}
): Record<string, string | number> => ({
  player_app: clamp(app, MAX_EVENT_VALUE),
  player_vendor: clamp(profile.vendor, MAX_EVENT_VALUE),
  player_platform: clamp(profile.platform, MAX_EVENT_VALUE),
  player_model: clamp(profile.model, MAX_EVENT_VALUE),
  player_category: clamp(profile.category, MAX_EVENT_VALUE),
  player_engine: clamp(profile.engine?.name, MAX_EVENT_VALUE),
  player_engine_version: profile.engine?.version ?? 0,
  player_below_floor: flag(profile.belowFloor),
  player_confidence: clamp(profile.confidence, MAX_EVENT_VALUE),
  player_sources: sources(profile),
  ...extra
})

type Gtag = (...args: unknown[]) => void

export interface TrackPlayerOptions {
  /** Which app is reporting, e.g. `weather`, `clock`, `menu-board`. */
  app: string
  /** Extra event params for an app-specific judgement. Not sent as user properties. */
  extra?: Record<string, string | number>
  /** Injectable for tests. */
  win?: Window & { gtag?: Gtag }
}

/**
 * Report the profile: set the user properties first, then fire the event, so the event
 * is already attributed. Returns whether anything was sent.
 *
 * `gtag` is missing whenever the app runs without a GA id (dev) or the tag was blocked
 * or failed to load. That is not an error worth surfacing on an unattended screen: the
 * app is the product, telemetry is not. So this is a silent no-op, and the boolean is
 * there for callers and tests that want to tell the two cases apart.
 */
export const trackPlayer = (profile: PlayerProfile, options: TrackPlayerOptions): boolean => {
  const { app, extra, win = typeof window !== 'undefined' ? window : undefined } = options
  const gtag = (win as { gtag?: Gtag } | undefined)?.gtag
  if (typeof gtag !== 'function') return false
  gtag('set', 'user_properties', playerUserProperties(profile, app))
  gtag('event', PLAYER_EVENT, playerEventParams(profile, app, extra))
  return true
}
