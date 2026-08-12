// The GA4 configuration that `./analytics` depends on, as data.
//
// Sending a param is only half of it: until a matching custom dimension exists in the
// property, GA4 collects the value but no report can see it. This module is the
// canonical definition of what must be registered, so the config is reviewable in the
// repo rather than living only in 16 GA4 admin screens, and so the same list can drive
// the registration for every property (see the recipe in the README).
//
// A test asserts these names are exactly the keys `playerUserProperties` emits, so code
// and GA config cannot drift apart silently.

/** GA4 custom-dimension scope. USER for everything here; see the note below. */
export type DimensionScope = 'USER' | 'EVENT'

export interface DimensionSpec {
  /** The event param / user property name. Must match the key `./analytics` sends. */
  parameterName: string
  /** Shown in GA4 reports and the dimension picker. */
  displayName: string
  description: string
  scope: DimensionScope
}

/**
 * Every field is USER scope, deliberately.
 *
 * On an unattended screen one GA4 user is one device, and a device's vendor, model and
 * engine never change. At user scope the value attaches to every event that screen ever
 * sends, so "show me everything from BrightSign players" filters any report, instead of
 * only the one event that carried the params. It also makes `totalUsers` broken down by
 * `player_vendor` a device census directly.
 *
 * GA4 allows 25 user-scoped dimensions per property; this uses 10.
 */
export const PLAYER_DIMENSIONS: readonly DimensionSpec[] = Object.freeze([
  {
    parameterName: 'player_vendor',
    displayName: 'Player vendor',
    description:
      "Signage player vendor (screenly, anthias, brightsign, yodeck, ...) or 'unknown' when it could not be named.",
    scope: 'USER'
  },
  {
    parameterName: 'player_platform',
    displayName: 'Player platform',
    description: 'Hardware/OS platform: raspberry-pi, tizen, webos, firetv, android, linux, ...',
    scope: 'USER'
  },
  {
    parameterName: 'player_model',
    displayName: 'Player model',
    description:
      'Device model parsed from the user agent. Free-form, so the highest-cardinality field here: expect an "(other)" row in wide reports.',
    scope: 'USER'
  },
  {
    parameterName: 'player_category',
    displayName: 'Player category',
    description:
      'signage | meeting-room | browser | bot. Filter to signage to exclude desk browsers and crawlers from a player census.',
    scope: 'USER'
  },
  {
    parameterName: 'player_engine',
    displayName: 'Player engine',
    description: 'Rendering engine family: qtwebengine, electron, chromium, gecko, webkit.',
    scope: 'USER'
  },
  {
    parameterName: 'player_engine_version',
    displayName: 'Player engine version',
    description:
      "Engine major version at the support floor, as a string for segmenting. 'unknown' when unreadable. Also registered as a metric, for averaging.",
    scope: 'USER'
  },
  {
    parameterName: 'player_below_floor',
    displayName: 'Player below support floor',
    description:
      "true / false / unknown. true means the engine renders below the kit's support floor and depends on the degraded gate.",
    scope: 'USER'
  },
  {
    parameterName: 'player_confidence',
    displayName: 'Player detection confidence',
    description:
      'high | medium | low. Filter to high when a vendor split has to be trusted; low is mostly bare-engine guesses.',
    scope: 'USER'
  },
  {
    parameterName: 'player_sources',
    displayName: 'Player detection sources',
    // GA4 caps a description at 150 chars; the full rationale lives in ./analytics.
    description:
      'Signals used, sorted and + joined. requestedWith means a Worker enriched it from the live request, which is what names Android WebView vendors.',
    scope: 'USER'
  },
  {
    parameterName: 'player_app',
    displayName: 'Player app',
    description:
      'Which app reported. Redundant within one property; keeps a blended report readable and survives any future consolidation.',
    scope: 'USER'
  }
])

export interface MetricSpec {
  parameterName: string
  displayName: string
  description: string
  scope: 'EVENT'
  /** GA4 measurement unit; STANDARD is a plain number. */
  measurementUnit: 'STANDARD'
}

/**
 * Custom metrics are a separate namespace from dimensions, so `player_engine_version`
 * can be both: the USER dimension above segments devices ("everything on Chromium 69"),
 * and this event-scoped metric lets GA4 average the version across a population. GA4
 * will only compute an average over a numeric custom metric, which is why
 * `playerEventParams` keeps the version numeric while the user property stringifies it.
 */
export const PLAYER_METRICS: readonly MetricSpec[] = Object.freeze([
  {
    parameterName: 'player_engine_version',
    displayName: 'Player engine version metric',
    description: 'Numeric engine major version, so GA4 can average it across devices.',
    scope: 'EVENT',
    measurementUnit: 'STANDARD'
  }
])
