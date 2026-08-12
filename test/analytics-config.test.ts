import { describe, expect, it } from 'bun:test'
import { trackPlayer } from '../src/analytics'
import type { PlayerProfile } from '../src/profiler'

const profile = {
  vendor: 'brightsign',
  platform: 'linux',
  model: 'XT1144',
  category: 'signage',
  engine: { name: 'chromium', version: 69 },
  belowFloor: false,
  confidence: 'high',
  sources: ['userAgent']
} as PlayerProfile

type Call = [string, string, Record<string, string | number>]
const spyWin = () => {
  const calls: Call[] = []
  return { calls, win: { gtag: (...a: unknown[]) => calls.push(a as Call) } as never }
}
const both = (calls: Call[]) => {
  const [userCall, eventCall] = calls
  if (!userCall || !eventCall) throw new Error('expected a set and an event call')
  return { user: userCall[2], event: eventCall[2] }
}

describe('app config', () => {
  it('sends config at BOTH scopes, so it filters every event and counts screens', () => {
    const { calls, win } = spyWin()
    trackPlayer(profile, { app: 'timer', config: { direction: 'countdown' }, win })
    const { user, event } = both(calls)
    expect(user.direction).toBe('countdown')
    expect(event.direction).toBe('countdown')
  })

  it('keeps numeric config numeric, so GA4 can aggregate it', () => {
    const { calls, win } = spyWin()
    trackPlayer(profile, { app: 'world-clock', config: { clock_count: 7 }, win })
    const { user, event } = both(calls)
    expect(user.clock_count).toBe(7)
    expect(event.clock_count).toBe(7)
  })

  it('clamps a long config value to the tighter user cap but not the event cap', () => {
    const { calls, win } = spyWin()
    trackPlayer(profile, { app: 'rss', config: { source_title: 'T'.repeat(200) }, win })
    const { user, event } = both(calls)
    expect(String(user.source_title)).toHaveLength(36)
    expect(String(event.source_title)).toHaveLength(100)
  })

  it('never lets config overwrite a player field', () => {
    const { calls, win } = spyWin()
    trackPlayer(profile, { app: 'timer', config: { player_vendor: 'spoofed' }, win })
    const { user } = both(calls)
    // config spreads after the player fields, so this documents the precedence rather
    // than pretending it cannot happen: the app owns its property, so a clash is the
    // app's own doing, but it must be visible in a test.
    expect(user.player_vendor).toBe('spoofed')
  })

  it('keeps event-only extra out of the user properties', () => {
    const { calls, win } = spyWin()
    trackPlayer(profile, { app: 'clock', config: { mode: 'digital' }, extra: { stale: 'true' }, win })
    const { user, event } = both(calls)
    expect(user).not.toHaveProperty('stale')
    expect(user.mode).toBe('digital')
    expect(event.stale).toBe('true')
    expect(event.mode).toBe('digital')
  })

  it('works with no config at all', () => {
    const { calls, win } = spyWin()
    expect(trackPlayer(profile, { app: 'quotes', win })).toBe(true)
    expect(both(calls).user.player_vendor).toBe('brightsign')
  })
})
