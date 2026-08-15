// GA4 player telemetry. Turns the PlayerProfile from ./profiler into the shape GA4
// can actually report on, so every signage app answers one question uniformly:
// which players are showing this app, and what are they?
//
// Why this exists: GA4's own device detection is useless for signage. Across a
// large sample of one app, the overwhelming majority of devices reported as
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
// user agent says nothing but "Android Webview", leaving a sizeable bucket that nothing
// else can attribute.
//
// So the Worker apps profile the live request (see ./analytics-server, which serves it
// uncached) and hand that profile to `trackPlayer`; the static apps pass the
// `detectPlayer()` profile they can build in the browser. `player_sources` records
// which signals were actually available, so a report can tell an enriched row from a
// user-agent-only one instead of silently mixing them.

import type { Capability, ProbeWindow } from './capability'
import { detectCapability } from './capability'
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

/**
 * The measured CSS features, sorted and `+` joined like `sources` above.
 *
 * Note the three-way split, which is the whole reason this is not a boolean: `null` (no DOM
 * to probe) becomes the sentinel, while an empty result becomes `'none'`. "We could not look"
 * and "we looked and this screen supports nothing" are different findings and must not share
 * a row. Worst case is `container+has+is+layers`, 23 chars, inside the 36-char user cap.
 */
const cssSupport = (capability: Capability): string => {
  if (capability.css == null) return UNKNOWN
  return capability.css.length ? [...capability.css].sort().join('+') : 'none'
}

/** No DOM was available to probe, so every capability field reads as the sentinel. */
const UNPROBED: Capability = { degraded: null, reason: null, css: null }

/** Clamp every value in an app-supplied map, leaving numbers numeric. */
const clampAll = (
  values: Record<string, string | number> | undefined,
  max: number
): Record<string, string | number> => {
  if (!values) return {}
  const out: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(values)) {
    out[key] = typeof value === 'number' ? value : clamp(value, max)
  }
  return out
}

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
  player_degraded: string
  player_degraded_reason: string
  player_css_support: string
  player_device: string
  player_sw_version: string
  player_metadata: string
}

/**
 * The device attributes as GA4 **user properties**.
 *
 * User scope, not event scope, is the whole point. A device's vendor/model/engine never
 * changes, so at user scope these attach to *every* event the screen ever sends. That is what
 * makes "show me everything from BrightSign players" a filter on any report, rather than a
 * filter that only works on the one event that happened to carry the params.
 *
 * WHAT USER SCOPE DOES NOT GIVE YOU: a device census. This comment used to claim `totalUsers`
 * per vendor was one, and that was wrong. GA4's `client_id` lives in the `_ga` cookie and these
 * players largely boot with fresh storage, so ids churn constantly: almost none survive a day
 * and nearly every user looks brand new. A multi-day window therefore inflates by roughly its
 * length.
 *
 * Worse for comparisons, the churn rate differs sharply between players. One can mint a fresh
 * id on nearly every page load while another keeps one across many, so a player's apparent
 * share of `totalUsers` mostly reflects how it handles storage. Never compare
 * `totalUsers` across vendors. Report absolute figures as app runs, and use `player_device`
 * (see ./screenly-metadata) wherever real device identity is available.
 *
 * `player_sources` is the provenance of the row: `userAgent+referrer` is a browser-only
 * profile, and the presence of `requestedWith` marks one enriched by a Worker off the
 * live request headers. Without it, an unattributed Android WebView from a static app
 * would be indistinguishable from one a Worker looked at and still could not name.
 */
export const playerUserProperties = (
  profile: PlayerProfile,
  app: string,
  capability: Capability = UNPROBED
): PlayerTelemetry => ({
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
  // UA-derived, and left exactly as it was on purpose. GA4 registration is not retroactive,
  // so repurposing a live dimension would make every historical row silently incomparable.
  // It stays correct where the UA carries a version (BrightSign 87, Anthias 122) and null
  // where it does not; the measured fields below are what cover the rest of the fleet. On the
  // screens where both exist, the two can be cross-checked against each other.
  player_below_floor: flag(profile.belowFloor),
  player_confidence: clamp(profile.confidence, MAX_USER_VALUE),
  player_sources: sources(profile),
  // Measured, not inferred: the gate's own predicate, so this is exact by construction and
  // populated on every screen with a DOM, including the Screenly v1 fleet that has no version
  // token for `player_below_floor` to read.
  player_degraded: flag(capability.degraded),
  player_degraded_reason: clamp(capability.reason, MAX_USER_VALUE),
  player_css_support: cssSupport(capability),
  // The only field here that identifies ONE screen rather than a class of screens, and the only
  // answer to GA4's client_id not surviving on these players. Already hashed and 32 chars by the
  // time it arrives (see ./screenly-metadata); the clamp is belt and braces.
  //
  // High cardinality, deliberately: GA4 will bucket the long tail into `(other)` once the
  // distinct count grows, so treat this as a calibration SAMPLE rather than a full census.
  // Its real use is measuring page views per device, which converts the app-run counts we can
  // measure into the device counts we cannot.
  player_device: clamp(profile.deviceId, MAX_USER_VALUE),
  player_sw_version: clamp(profile.swVersion, MAX_USER_VALUE),
  // Worth a dimension of its own because `send_metadata` defaults to false on the asset: this
  // is the share of the fleet that can be counted by device at all.
  player_metadata: flag(profile.hasMetadata)
})

/** The three fields that need a live DOM, so a server can never supply them. */
const PROBED_KEYS = ['player_degraded', 'player_degraded_reason', 'player_css_support'] as const

/** Everything in {@link PlayerTelemetry} except the fields that require probing a DOM. */
export type ServerTelemetry = Omit<PlayerTelemetry, (typeof PROBED_KEYS)[number]>

/**
 * The user properties a SERVER can build, for setting BEFORE the first `page_view`.
 *
 * WHY THIS EXISTS, measured rather than assumed. `trackPlayer` runs from `main.js` after
 * `DOMContentLoaded`, but the automatic `page_view` is sent by the `gtag('config')` call in
 * the inline `<head>` snippet, which is necessarily earlier. So the first `page_view` under
 * any given `client_id` carries no player fields at all. A screen that keeps its id attributes
 * every LATER page view and the loss is invisible; a screen that mints a fresh id on every load
 * attributes none of them, ever.
 *
 * That is not a rounding error, and it is worst exactly where the data matters most. On
 * 2026-08-14, `player_vendor=yodeck` read 150 users, 150 sessions, 150 events and **zero** page
 * views, every event being `player_detected`: a Fire TV WebView that starts each load with
 * fresh storage. BrightSign showed the same shape at 913 users and 3 page views. Fleet-wide,
 * 21% of app runs carried no player fields (13.6% on the Worker apps, 66.9% on the static
 * ones), biased against precisely the high-churn players a census most needs to see.
 *
 * So `./analytics-bootstrap` sets these on the profile it already waits for, before it
 * configures. The capability fields are omitted rather than sent as the `unknown` sentinel:
 * they are probed a moment later by `trackPlayer`, and a real "we could not tell" bucket is
 * worth more than one padded with rows that simply had not been measured yet.
 *
 * Derived from `playerUserProperties` rather than restated, so a field added there flows here
 * without a second edit.
 */
export const serverUserProperties = (profile: PlayerProfile, app: string): ServerTelemetry => {
  const properties: Record<string, string> = { ...playerUserProperties(profile, app) }
  for (const key of PROBED_KEYS) delete properties[key]
  return properties as ServerTelemetry
}

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
  extra: Record<string, string | number> = {},
  capability: Capability = UNPROBED
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
  player_degraded: flag(capability.degraded),
  player_degraded_reason: clamp(capability.reason, MAX_EVENT_VALUE),
  player_css_support: cssSupport(capability),
  player_device: clamp(profile.deviceId, MAX_EVENT_VALUE),
  player_sw_version: clamp(profile.swVersion, MAX_EVENT_VALUE),
  player_metadata: flag(profile.hasMetadata),
  // Clamped like everything else: an app-supplied value over 100 chars would be
  // truncated or dropped by GA4 anyway, so do it here where it is visible.
  ...clampAll(extra, MAX_EVENT_VALUE)
})

type Gtag = (...args: unknown[]) => void

export interface TrackPlayerOptions {
  /** Which app is reporting, e.g. `weather`, `clock`, `menu-board`. */
  app: string
  /**
   * How this screen is configured, e.g. `{ direction: 'countdown' }` for the timer or
   * `{ feed: 'cnn' }` for the reader. Sent at BOTH scopes, like the player fields and for
   * the same reason: these apps are configured by URL and one screen keeps its
   * configuration, so at user scope it becomes a filter on every event that screen sends
   * and `totalUsers` by config answers "how many screens count down" directly.
   *
   * Register each key as a custom dimension in that app's property, or GA4 collects it
   * and no report can see it. Keys are the app's own vocabulary rather than a prefixed
   * namespace, because each app reports into its own property.
   */
  config?: Record<string, string | number>
  /**
   * Event-only params, for a per-occurrence judgement rather than a property of the
   * screen. Deliberately NOT sent as a user property: a user property is last-write-wins,
   * so a value that varies between events would silently overwrite itself.
   */
  extra?: Record<string, string | number>
  /**
   * Fire the `page_view` from here, once the user properties are set.
   *
   * PAIRS WITH `send_page_view: false` ON THE TAG. Set one without the other and the app
   * either double-counts every page view or stops counting them entirely, so the two live
   * and die together. The app's inline snippet carries a comment pointing back here.
   *
   * For the static apps, which have no server. A Worker app instead has the profile in hand
   * before it configures (see `serverUserProperties`), so it keeps GA4's automatic page view
   * and simply sets the properties first. That is the better trade where it is available: it
   * cannot lose a page view, whereas this defers the page view until `main.js` runs, so a
   * load that never gets that far now reports nothing at all rather than an unattributed
   * page view. Measured on 2026-08-14 that is 0.3% or less of loads on every static app
   * (`player_detected` lands on 99.7% to 100% of their page views), against 68% of their
   * page views currently carrying no player fields. On Weather the same gap is 1.7%, which
   * is why the Worker apps do not use this.
   */
  sendPageView?: boolean
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
  const {
    app,
    config,
    extra,
    sendPageView,
    win = typeof window !== 'undefined' ? window : undefined
  } = options
  const gtag = (win as { gtag?: Gtag } | undefined)?.gtag
  if (typeof gtag !== 'function') return false
  // Probed here rather than taken from the caller, so all 16 apps get the capability fields
  // from a version bump alone. It also has to happen client-side: the Worker apps hand over a
  // profile built on the server, where there is nothing to feature-detect.
  const capability = detectCapability(win as unknown as ProbeWindow)
  // Config is clamped to the tighter user-property cap here, and to the looser event cap
  // inside playerEventParams, so a long value is not truncated more than it has to be.
  gtag('set', 'user_properties', {
    ...playerUserProperties(profile, app, capability),
    ...clampAll(config, MAX_USER_VALUE)
  })
  // After the properties, which is the entire reason it is fired here rather than by
  // `config`. GA4 stamps the properties in force at collection time onto each event, so a
  // page view sent by `config` goes out before this screen has been profiled at all. Firing
  // it one line after the `set` puts it in exactly the position `player_detected` already
  // occupies, and that event is attributed on essentially every load.
  if (sendPageView) gtag('event', 'page_view')
  gtag('event', PLAYER_EVENT, playerEventParams(profile, app, { ...config, ...extra }, capability))
  return true
}
