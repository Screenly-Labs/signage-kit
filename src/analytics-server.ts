// Server half of the player telemetry, for the Worker apps.
//
// The page cannot see the richest signal. `X-Requested-With` carries the Android
// WebView package name and is never exposed to page JS, yet it is the only thing that
// names a yodeck / pisignage / xogo / iadea / ablesign / harison / zoom / google-meet
// player: their user agents say nothing beyond "Android Webview". A Worker sees the
// header, so it can profile what the browser cannot.
//
// The profile still has to be REPORTED by the page (GA4 needs the screen's own
// client_id, and see the caching note in ./analytics), so the Worker's job is only to
// hand it over. This module serves it on its own endpoint, deliberately uncached: the
// SSR HTML is cached at the edge on a key with no user-agent component, so anything
// baked into that HTML would be a profile of whichever screen missed the cache. A
// separate no-store response is per-request by construction, and it stays correct even
// while the HTML itself is served from cache.
//
// Kept in its own module so importing `./analytics` into a browser bundle never pulls
// the server path in with it. The dependency runs one way only: this module imports
// `./analytics` to build the user properties, so the GA4 parameter names have exactly one
// definition. Nothing it pulls in touches the DOM at module level, so a Worker bundle is
// unaffected.

import { serverUserProperties } from './analytics'
import type { ServerTelemetry } from './analytics'
import { detectPlayerFromRequest } from './profiler'
import type { PlayerProfile } from './profiler'
import { gaClientIdFrom, hashDeviceId, screenlyDeviceId } from './screenly-metadata'

/**
 * The route every Worker app mounts, so the client half can fetch a profile without
 * each app inventing its own path. Exclude it from the app's page cache.
 */
export const PLAYER_PROFILE_PATH = '/api/player'

/**
 * `no-store` is the load-bearing header here, not a nicety. If any layer (the edge, the
 * Worker's own `caches.default`, or the player's embedded browser, which on some devices
 * caches far more eagerly than a desktop one) retains this response, every subsequent
 * screen is handed the first screen's identity and the census silently collapses onto
 * one vendor. `Vary` is redundant under `no-store` but is sent anyway, so the intent
 * survives someone relaxing the cache header later.
 */
export const PLAYER_PROFILE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
  vary: 'user-agent, referer, x-requested-with'
})

/**
 * Where the Screenly device id becomes a pseudonym.
 *
 * `detectPlayerFromRequest` returns `deviceId: null` by design, so the raw
 * `X-Screenly-hostname` value exists only inside this function and is replaced by its hash
 * before anything is serialised. GA4 therefore never receives a raw Screenly device id, which
 * would be a directly joinable key into device inventory.
 *
 * Async purely because `crypto.subtle.digest` is. Both entry points below are async as a
 * result, which is source-compatible with the apps: they mount the route as
 * `(c) => playerProfileResponse(c.req.raw)` and Hono accepts a promise.
 */
const withDeviceId = async (
  request: { headers: Headers },
  salt?: string
): Promise<PlayerProfile> => {
  const profile = detectPlayerFromRequest(request)
  const raw = screenlyDeviceId(request)
  if (!raw) return profile
  const hash = await hashDeviceId(raw, salt)
  // Both derived from the one hash, so the GA4 client_id and the player_device dimension can
  // never disagree about which screen this is.
  return { ...profile, deviceId: hash, gaClientId: gaClientIdFrom(hash) }
}

/** Options for the two entry points. */
export interface PlayerProfileOptions {
  /**
   * Optional salt for the device-id hash, e.g. a Worker secret bound as an env var. Without
   * it the hash still cannot be reversed by guessing, but a holder of Screenly's device list
   * could confirm a given id by computing its hash. Pass one to close that gap.
   */
  salt?: string
  /**
   * The app's own name, e.g. `weather`. Supplying it adds `userProperties` to the payload, so
   * the inline bootstrap can set the player fields BEFORE the automatic `page_view` and that
   * page view is attributed (see `serverUserProperties`). Omit it and the payload is exactly
   * what it was: the opt-in is explicit, so a caller cannot end up shipping `player_app:
   * "unknown"` to GA4 by forgetting an argument.
   */
  app?: string
}

/**
 * What `/api/player` actually returns: the profile, plus the ready-made user properties when
 * the caller named its app.
 *
 * Built here rather than in the snippet on purpose. The inline bootstrap is an unminified
 * string in every page's `<head>`, and teaching it to map a profile onto GA4 parameter names
 * would put a second copy of the schema somewhere no test can reach. This keeps the snippet
 * dumb enough to be obviously correct: it forwards an object it never inspects.
 */
export interface PlayerProfilePayload extends PlayerProfile {
  userProperties?: ServerTelemetry
}

const payload = (profile: PlayerProfile, app?: string): PlayerProfilePayload =>
  app ? { ...profile, userProperties: serverUserProperties(profile, app) } : profile

/**
 * Profile the live request and return it as an uncacheable JSON response.
 *
 * Accepts anything with a `Headers`, matching `detectPlayerFromRequest`, so it takes a
 * `Request` or a Hono `c.req.raw` directly.
 */
export const playerProfileResponse = async (
  request: { headers: Headers },
  options: PlayerProfileOptions = {}
): Promise<Response> =>
  new Response(JSON.stringify(payload(await withDeviceId(request, options.salt), options.app)), {
    status: 200,
    headers: { ...PLAYER_PROFILE_HEADERS }
  })

/**
 * The profile as a plain object, for a Worker that would rather fold it into a response
 * it is already building than mount a second route. The same no-store rule applies to
 * whatever carries it.
 */
export const playerProfileFromRequest = async (
  request: { headers: Headers },
  options: PlayerProfileOptions = {}
): Promise<PlayerProfilePayload> => payload(await withDeviceId(request, options.salt), options.app)
