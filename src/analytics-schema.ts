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
 * A device's vendor, model and engine never change. At user scope the value attaches to every
 * event that screen ever sends, so "show me everything from BrightSign players" filters any
 * report, instead of only the one event that carried the params.
 *
 * It does NOT make `totalUsers` by `player_vendor` a device census. That claim used to be here
 * and it was wrong: see the warning in ./analytics. Use `player_device` for device identity.
 *
 * GA4 allows 25 user-scoped dimensions per property; this uses 16, and each app adds its own
 * config keys on top (at most 5 today), so there is room but it is not unlimited.
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
    description:
      'Hardware/OS platform: linux-arm (ARM boards, incl. most Pis), raspberry-pi (legacy UA only), tizen, webos, firetv, android, linux, ...',
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
  },
  // Measured in the browser rather than parsed from the UA, which is why they exist: the
  // Screenly v1 viewer sends no version token, so player_below_floor is null for the largest
  // fleet in the census. See ./capability.
  {
    parameterName: 'player_degraded',
    displayName: 'Player on degraded path',
    description:
      "true / false / unknown. Measured, not inferred: the degraded gate's own predicate, so it is populated even where the UA carries no version.",
    scope: 'USER'
  },
  {
    parameterName: 'player_degraded_reason',
    displayName: 'Player degraded reason',
    description:
      'none | old | slow | old+slow | probe-failed. Splits a stale engine from weak hardware, which the UA cannot see at all.',
    scope: 'USER'
  },
  {
    parameterName: 'player_css_support',
    displayName: 'Player CSS support',
    description:
      "Measured CSS features, sorted and + joined: is, layers, has, container. 'none' if none, 'unknown' if unprobed. A set: versions are not monotonic.",
    scope: 'USER'
  },
  // From the Screenly asset-metadata headers, which only a Worker app can see and only when
  // the asset has "Send metadata" on. See ./screenly-metadata for why these beat any
  // fingerprint: GA4's client_id does not survive on these players.
  {
    parameterName: 'player_device',
    displayName: 'Player device key',
    description:
      'Hashed stable Screenly device id. HIGH CARDINALITY: GA4 buckets the tail into (other), so use it to calibrate views-per-device, not as a census.',
    scope: 'USER'
  },
  {
    parameterName: 'player_sw_version',
    displayName: 'Player software version',
    description:
      "Screenly player generation from X-Screenly-version, e.g. 'v2'. NOT a browser engine version, so it says nothing about the support floor.",
    scope: 'USER'
  },
  {
    parameterName: 'player_metadata',
    displayName: 'Player sent metadata',
    description:
      "true / false / unknown ('unknown' = no request seen). send_metadata defaults off, so this is the share of the fleet countable by device at all.",
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
