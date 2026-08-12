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
      player_sources: 'userAgent'
    })
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
