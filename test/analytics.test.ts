import { describe, expect, it } from 'bun:test'
import {
  PLAYER_EVENT,
  UNKNOWN,
  playerEventParams,
  playerUserProperties,
  trackPlayer
} from '../src/analytics'
import type { PlayerProfile } from '../src/profiler'

const profile = (over: Partial<PlayerProfile> = {}): PlayerProfile =>
  ({
    vendor: 'brightsign',
    platform: 'linux',
    model: 'XT1144',
    category: 'signage',
    engine: { name: 'chromium', version: 69 },
    belowFloor: true,
    confidence: 'high',
    sources: ['userAgent'],
    // Defaults match a browser-built profile: no request headers, so no Screenly metadata.
    deviceId: null,
    swVersion: null,
    hasMetadata: null,
    ...over
  }) as PlayerProfile

// A fake gtag that records the calls, so we can assert ORDER as well as payload:
// the user properties have to be set before the event, or the event is attributed
// without them.
type Call = [string, string, Record<string, string | number>]
const spyWin = () => {
  const calls: Call[] = []
  return {
    calls,
    win: { gtag: (...args: unknown[]) => calls.push(args as Call) } as never
  }
}

describe('playerUserProperties', () => {
  it('flattens a profile into the user-scoped fields', () => {
    expect(playerUserProperties(profile(), 'weather')).toEqual({
      player_app: 'weather',
      player_vendor: 'brightsign',
      player_platform: 'linux',
      player_model: 'XT1144',
      player_category: 'signage',
      player_engine: 'chromium',
      player_engine_version: '69',
      player_below_floor: 'true',
      player_confidence: 'high',
      player_sources: 'userAgent',
      // No capability argument, so nothing was probed. These read as the sentinel rather
      // than as `false`, because "we did not look" is not "we looked and it is fine".
      player_degraded: 'unknown',
      player_degraded_reason: 'unknown',
      player_css_support: 'unknown',
      // No request headers in a browser-built profile, so no Screenly metadata. `unknown`
      // rather than `false` for player_metadata: we could not look, which is not the same as
      // looking and finding it off.
      player_device: 'unknown',
      player_sw_version: 'unknown',
      player_metadata: 'unknown'
    })
  })

  it('carries the Screenly device key and player generation when metadata was present', () => {
    const props = playerUserProperties(
      profile({ deviceId: 'a'.repeat(32), swVersion: 'v2', hasMetadata: true }),
      'weather'
    )
    expect(props.player_device).toBe('a'.repeat(32))
    expect(props.player_sw_version).toBe('v2')
    expect(props.player_metadata).toBe('true')
  })

  it('sends the sentinel for every null rather than omitting the key', () => {
    const p = playerUserProperties(
      profile({
        vendor: null,
        platform: null,
        model: null,
        engine: { name: null, version: null },
        belowFloor: null
      }),
      'timer'
    )
    expect(p.player_vendor).toBe(UNKNOWN)
    expect(p.player_platform).toBe(UNKNOWN)
    expect(p.player_model).toBe(UNKNOWN)
    expect(p.player_engine).toBe(UNKNOWN)
    expect(p.player_engine_version).toBe(UNKNOWN)
    expect(p.player_below_floor).toBe(UNKNOWN)
  })

  it('distinguishes belowFloor false from unknown', () => {
    expect(playerUserProperties(profile({ belowFloor: false }), 'a').player_below_floor).toBe(
      'false'
    )
    expect(playerUserProperties(profile({ belowFloor: null }), 'a').player_below_floor).toBe(UNKNOWN)
  })

  it('clamps values to the 36-char GA4 user-property cap', () => {
    const long = 'M'.repeat(80)
    const p = playerUserProperties(profile({ model: long }), 'a')
    expect(p.player_model).toHaveLength(36)
  })

  it('keeps every key inside the 24-char GA4 user-property name cap', () => {
    for (const key of Object.keys(playerUserProperties(profile(), 'a'))) {
      expect(key.length).toBeLessThanOrEqual(24)
    }
  })
})

describe('player_sources', () => {
  it('sorts and joins the signals so one combination is one row', () => {
    const p = playerUserProperties(profile({ sources: ['userAgent', 'referrer'] }), 'a')
    expect(p.player_sources).toBe('referrer+userAgent')
  })

  it('marks a header-enriched profile distinctly from a browser-only one', () => {
    const server = playerUserProperties(
      profile({ sources: ['userAgent', 'requestedWith'] }),
      'a'
    ).player_sources
    const client = playerUserProperties(profile({ sources: ['userAgent'] }), 'a').player_sources
    expect(server).toContain('requestedWith')
    expect(server).not.toBe(client)
  })

  it('falls back to the sentinel when nothing contributed', () => {
    expect(playerUserProperties(profile({ sources: [] }), 'a').player_sources).toBe(UNKNOWN)
  })
})

describe('playerEventParams', () => {
  it('keeps the engine version numeric so GA4 can average it', () => {
    expect(playerEventParams(profile(), 'weather').player_engine_version).toBe(69)
  })

  it('sends 0 rather than the sentinel for an unknown version, to stay numeric', () => {
    expect(
      playerEventParams(profile({ engine: { name: 'chromium', version: null } }), 'a')
        .player_engine_version
    ).toBe(0)
  })

  it('allows the 100-char event cap, which is looser than the user cap', () => {
    const long = 'M'.repeat(200)
    expect(playerEventParams(profile({ model: long }), 'a').player_model).toHaveLength(100)
  })

  it('merges app-specific extra params', () => {
    const p = playerEventParams(profile(), 'clock', { player_stale: 'true' })
    expect(p.player_stale).toBe('true')
    expect(p.player_vendor).toBe('brightsign')
  })

  it('keeps every key inside the 40-char GA4 param name cap', () => {
    for (const key of Object.keys(playerEventParams(profile(), 'a'))) {
      expect(key.length).toBeLessThanOrEqual(40)
    }
  })
})

describe('trackPlayer', () => {
  it('sets the user properties BEFORE firing the event', () => {
    const { calls, win } = spyWin()
    expect(trackPlayer(profile(), { app: 'weather', win })).toBe(true)
    expect(calls).toHaveLength(2)
    const [userCall, eventCall] = calls
    if (!userCall || !eventCall) throw new Error('expected a set and an event call')
    expect(userCall[0]).toBe('set')
    expect(userCall[1]).toBe('user_properties')
    expect(eventCall[0]).toBe('event')
    expect(eventCall[1]).toBe(PLAYER_EVENT)
  })

  // The capability fields exist to cover the fleet whose UA carries no version, so what
  // matters is that trackPlayer PROBES rather than relying on the caller to pass anything.
  // That is what lets all 16 apps pick this up from a version bump alone, and it is also the
  // only path that works for the Worker apps, whose profile is built server-side where there
  // is nothing to feature-detect.
  it('probes the window itself and reports capability at both scopes', () => {
    const calls: Call[] = []
    const win = {
      gtag: (...args: unknown[]) => calls.push(args as Call),
      Element: { prototype: { replaceChildren: () => {} } },
      navigator: { deviceMemory: 8, hardwareConcurrency: 8 },
      CSS: { supports: () => true },
      CSSLayerBlockRule: class {}
    } as never

    // A profile with NO engine version at all: the Screenly v1 case, where player_below_floor
    // is structurally unknowable and the measured fields have to carry the answer.
    expect(
      trackPlayer(profile({ engine: { name: 'chromium', version: null }, belowFloor: null }), {
        app: 'weather',
        win
      })
    ).toBe(true)

    const [userCall, eventCall] = calls
    if (!userCall || !eventCall) throw new Error('expected a set and an event call')
    for (const props of [userCall[2], eventCall[2]] as Array<Record<string, unknown>>) {
      expect(props.player_below_floor).toBe('unknown') // UA cannot say, and does not pretend to
      expect(props.player_degraded).toBe('false') // measurement can
      expect(props.player_degraded_reason).toBe('none')
      expect(props.player_css_support).toBe('container+has+is+layers')
    }
  })

  it('reports capability as unknown when the window has nothing to probe', () => {
    const { calls, win } = spyWin()
    trackPlayer(profile(), { app: 'weather', win })
    const userProps = calls[0]?.[2] as Record<string, unknown>
    // spyWin has a gtag and nothing else, so the engine probe finds no Element. It degrades
    // defensively rather than claiming the screen is fine.
    expect(userProps.player_degraded).toBe('true')
    expect(userProps.player_degraded_reason).toBe('old')
  })

  it('sends the same vendor at both scopes', () => {
    const { calls, win } = spyWin()
    trackPlayer(profile(), { app: 'weather', win })
    const [userCall, eventCall] = calls
    if (!userCall || !eventCall) throw new Error('expected a set and an event call')
    const userProps = userCall[2]
    const eventParams = eventCall[2]
    expect(userProps.player_vendor).toBe('brightsign')
    expect(eventParams.player_vendor).toBe('brightsign')
  })

  it('does not send the app-specific extra as a user property', () => {
    const { calls, win } = spyWin()
    trackPlayer(profile(), { app: 'clock', extra: { player_stale: 'true' }, win })
    const [userCall, eventCall] = calls
    if (!userCall || !eventCall) throw new Error('expected a set and an event call')
    expect(userCall[2]).not.toHaveProperty('player_stale')
    expect(eventCall[2]).toHaveProperty('player_stale')
  })

  it('is a silent no-op when gtag is absent (blocked tag, or dev with no GA id)', () => {
    expect(trackPlayer(profile(), { app: 'weather', win: {} as never })).toBe(false)
  })

  it('does not throw when there is no window at all', () => {
    expect(trackPlayer(profile(), { app: 'weather', win: undefined })).toBe(false)
  })
})

// The static apps have no server, so they cannot know the player before `config` fires.
// Instead their tag is configured with `send_page_view: false` and the page view is fired
// here, one line after the user properties, which is the position `player_detected` already
// occupies and is attributed on essentially every load.
describe('trackPlayer: deferring the page view', () => {
  it('fires page_view AFTER the user properties, so it carries the player fields', () => {
    const { calls, win } = spyWin()
    trackPlayer(profile(), { app: 'quotes', sendPageView: true, win })
    const setAt = calls.findIndex((c) => c[0] === 'set' && c[1] === 'user_properties')
    const viewAt = calls.findIndex((c) => c[0] === 'event' && c[1] === 'page_view')
    expect(setAt).toBeGreaterThanOrEqual(0)
    expect(viewAt).toBeGreaterThan(setAt)
  })

  it('still fires player_detected, so the countable occurrence is not lost', () => {
    const { calls, win } = spyWin()
    trackPlayer(profile(), { app: 'quotes', sendPageView: true, win })
    expect(calls.filter((c) => c[0] === 'event' && c[1] === PLAYER_EVENT)).toHaveLength(1)
    expect(calls.filter((c) => c[0] === 'event' && c[1] === 'page_view')).toHaveLength(1)
  })

  it('sends NO page_view unless asked, so a Worker app cannot double-count', () => {
    // The Worker apps keep GA4's automatic page view and set the properties before it.
    // If this defaulted on, every one of their loads would be counted twice.
    const { calls, win } = spyWin()
    trackPlayer(profile(), { app: 'weather', win })
    expect(calls.filter((c) => c[1] === 'page_view')).toHaveLength(0)
  })

  it('sends nothing at all when gtag is missing, page view included', () => {
    // A blocked or unloaded tag must not become an exception on an unattended screen.
    expect(trackPlayer(profile(), { app: 'quotes', sendPageView: true, win: {} as never })).toBe(
      false
    )
  })
})
