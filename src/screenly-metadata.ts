// The Screenly asset-metadata headers, which are the strongest player signal available to
// any of these apps and the only stable per-DEVICE identifier in the whole system.
//
// A Screenly player optionally injects this set into the request for a web asset (the
// "Send metadata" switch in the asset editor's web settings):
//
//   X-Screenly-hostname:      srly-jmar75ko6xp651j   <- stable player id, NOT a network name
//   X-Screenly-hardware:      x86
//   X-Screenly-version:       v2
//   X-Screenly-screen-name:   dizzy cherry
//   X-Screenly-location-name: Cape Town
//   X-Screenly-lat/-lng:      -33.925278 / 18.423889
//   X-Screenly-tags:          srly-jmar75ko6xp651j,custom-label
//
// WHY THIS MATTERS MORE THAN ANY FINGERPRINT.
//
// GA4's client_id lives in the _ga cookie, and these players largely start with fresh storage,
// so ids churn constantly: almost none survive a day, and nearly every user looks brand new. The
// churn rate also differs sharply between players, so totalUsers is not comparable ACROSS
// vendors, not merely inflated.
//
// Passive fingerprinting cannot fix that here, and would fail in a worse direction. Signage
// fleets are deliberately identical: whole populations share one frozen browser image, and the
// dominant player UA carries no version token at all. Canvas, WebGL, audio, fonts and resolution
// are identical across identical hardware, so a fingerprint-derived id would collapse many
// screens into one identity. The present over-count is detectable; a colliding fingerprint
// under-counts silently, which is not.
//
// `X-Screenly-hostname` sidesteps all of it by being an actual device id.
//
// WHAT IS DELIBERATELY NOT READ.
//
// `screen-name`, `location-name`, `lat`, `lng` and `tags` identify a customer's premises and
// often carry human-chosen names. The telemetry has no question that needs them, so they are
// not parsed, not reported, and must not reach GA4. Only the device id (hashed), the hardware
// string and the player version are used. Note `tags` also contains the device id, so it is
// skipped rather than treated as a fallback source for it.

/** Header names, lowercased. `Headers.get` is case-insensitive, but keep them canonical. */
const HOSTNAME = 'x-screenly-hostname'
const HARDWARE = 'x-screenly-hardware'
const VERSION = 'x-screenly-version'

/**
 * The subset of the metadata worth keeping. Never carries the raw device id: see
 * `screenlyDeviceId` for that, which is named so a caller cannot reach it by accident.
 */
export interface ScreenlyMetadata {
  /** `X-Screenly-hardware`, e.g. `x86`. The only model information a Screenly UA offers. */
  hardware: string | null
  /**
   * `X-Screenly-version`, e.g. `v2`. The PLAYER generation, not a browser engine version.
   * It must never feed `belowFloor`: a v2 player says nothing about which Chromium it ships.
   */
  playerVersion: string | null
  /** True when any of the three headers is present, i.e. this is a Screenly player. */
  present: boolean
}

const clean = (value: string | null): string | null => {
  if (value == null) return null
  const trimmed = value.trim()
  // A header present but empty is not a value. Cap the length so a hostile or malfunctioning
  // sender cannot push a megabyte into a GA4 field, which would be truncated anyway.
  return trimmed && trimmed.length <= 64 ? trimmed : null
}

/** Parse the metadata from a request's headers. Server-side only; page JS cannot see these. */
export const screenlyMetadataFromRequest = (request: { headers: Headers }): ScreenlyMetadata => {
  const { headers } = request
  const hardware = clean(headers.get(HARDWARE))
  const playerVersion = clean(headers.get(VERSION))
  // `present` keys off the raw hostname too, so a player that sends only the id still counts
  // as a Screenly player rather than looking like it sent nothing.
  const present = Boolean(hardware || playerVersion || clean(headers.get(HOSTNAME)))
  return { hardware, playerVersion, present }
}

/**
 * The RAW device id. Deliberately a separate call rather than a field on `ScreenlyMetadata` or
 * `PlayerProfile`, so the raw value can never ride along into a response by accident. Anything
 * leaving the Worker must go through `hashDeviceId` first.
 */
export const screenlyDeviceId = (request: { headers: Headers }): string | null =>
  clean(request.headers.get(HOSTNAME))

/**
 * A pseudonymous, stable device key: SHA-256 over the id, hex, truncated to 128 bits.
 *
 * Truncated to 32 chars because a GA4 user-property value caps at 36. 128 bits keeps collisions
 * irrelevant at any fleet size we will ever see (far below one in a trillion for millions of
 * devices), while being short enough to report.
 *
 * `salt` is optional and defaults to empty, which is honest rather than ideal: unsalted, anyone
 * already holding Screenly's device list could confirm a hash by computing it. It cannot be
 * reversed by guessing, since the id space is large and opaque. Pass a Worker secret to close
 * the confirmation gap. The point of hashing either way is that GA4 never receives a raw
 * Screenly device id, which would otherwise be a directly joinable key into device inventory.
 */
/**
 * The same device key, formatted as a GA4 `client_id`.
 *
 * This is the field that makes GA4's own unique identifier stable for a screen. Set as
 * `client_id` at config time, one screen is one GA4 user no matter how often its storage is
 * wiped, instead of minting a fresh id on every page load.
 *
 * Shaped as `<uint32>.<uint32>` to match the format GA4 generates natively (a random int and a
 * timestamp) rather than passing raw hex, because an unusual value risks being normalised or
 * rejected somewhere in the pipeline and this costs nothing. Derived from the first 64 bits of
 * the same hash, so `player_device` and the `client_id` always agree about which screen this is.
 *
 * 64 bits is ample: even at a million devices the collision probability is far below one in a
 * million, and a collision would merely merge two screens rather than corrupt anything.
 */
export const gaClientIdFrom = (hash: string): string => {
  const high = Number.parseInt(hash.slice(0, 8), 16)
  const low = Number.parseInt(hash.slice(8, 16), 16)
  return `${high}.${low}`
}

export const hashDeviceId = async (deviceId: string, salt = ''): Promise<string> => {
  // NUL separator so ('a', 'bc') and ('ab', 'c') cannot hash to the same value. Written as an
  // escape, not a literal: a raw NUL in the source makes grep treat the file as binary.
  const bytes = new TextEncoder().encode(`${salt}\u0000${deviceId}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  let hex = ''
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0')
  return hex.slice(0, 32)
}
