import { describe, expect, it } from 'bun:test'
import { playerEventParams, playerUserProperties, serverUserProperties } from '../src/analytics'
import { PLAYER_DIMENSIONS, PLAYER_METRICS } from '../src/analytics-schema'
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

// The whole point of the schema module: if a field is added to the telemetry and not to
// the schema, GA4 silently collects it into a dimension nobody registered and no report
// can see it. These tests make that a build failure instead.
describe('schema matches what the code actually sends', () => {
  it('registers exactly the user properties that are emitted', () => {
    const emitted = Object.keys(playerUserProperties(profile, 'weather')).sort()
    const declared = PLAYER_DIMENSIONS.map((d) => d.parameterName).sort()
    expect(declared).toEqual(emitted)
  })

  it('declares every metric as a param the event actually carries', () => {
    const emitted = Object.keys(playerEventParams(profile, 'weather'))
    for (const m of PLAYER_METRICS) expect(emitted).toContain(m.parameterName)
  })
})

describe('schema respects the GA4 limits', () => {
  it('keeps user-property names inside the 24-char cap', () => {
    for (const d of PLAYER_DIMENSIONS) {
      if (d.scope === 'USER') expect(d.parameterName.length).toBeLessThanOrEqual(24)
    }
  })

  it('stays inside the 25 user-scoped dimensions a property allows', () => {
    expect(PLAYER_DIMENSIONS.filter((d) => d.scope === 'USER')).not.toBeEmpty()
    expect(PLAYER_DIMENSIONS.filter((d) => d.scope === 'USER').length).toBeLessThanOrEqual(25)
  })

  it('uses unique parameter names within each namespace', () => {
    const dims = PLAYER_DIMENSIONS.map((d) => d.parameterName)
    expect(new Set(dims).size).toBe(dims.length)
    const mets = PLAYER_METRICS.map((m) => m.parameterName)
    expect(new Set(mets).size).toBe(mets.length)
  })

  // Both of these were learned the hard way: the GA4 Admin API rejected the first
  // attempt at registering this schema, once for an over-long description and once for
  // a metric display name containing parentheses.
  it('keeps every description inside the 150-char GA4 cap', () => {
    for (const d of PLAYER_DIMENSIONS) expect(d.description.length).toBeLessThanOrEqual(150)
    for (const m of PLAYER_METRICS) expect(m.description.length).toBeLessThanOrEqual(150)
  })

  it('keeps metric display names to the charset GA4 accepts', () => {
    // "Value for field display_name must only contain alphanumeric, underscore, or space"
    for (const m of PLAYER_METRICS) expect(m.displayName).toMatch(/^[A-Za-z0-9_ ]+$/)
  })

  it('keeps display names inside the 82-char GA4 cap', () => {
    for (const d of PLAYER_DIMENSIONS) expect(d.displayName.length).toBeLessThanOrEqual(82)
    for (const m of PLAYER_METRICS) expect(m.displayName.length).toBeLessThanOrEqual(82)
  })

  it('documents every field, so the GA4 picker is self-explanatory', () => {
    for (const d of PLAYER_DIMENSIONS) {
      expect(d.displayName.length).toBeGreaterThan(0)
      expect(d.description.length).toBeGreaterThan(20)
    }
  })
})

// serverUserProperties is derived from playerUserProperties so a new field flows into the
// bootstrap payload without a second edit. These pin that relationship down.
describe('the server-side subset stays in step', () => {
  it('is playerUserProperties minus exactly the three probed fields', () => {
    const all = Object.keys(playerUserProperties(profile, 'weather'))
    const server = Object.keys(serverUserProperties(profile, 'weather'))
    expect(server.sort()).toEqual(
      all
        .filter(
          (k) => !['player_degraded', 'player_degraded_reason', 'player_css_support'].includes(k)
        )
        .sort()
    )
  })

  it('agrees value for value with the full set on the fields it does send', () => {
    const all: Record<string, string> = { ...playerUserProperties(profile, 'weather') }
    const server: Record<string, string> = { ...serverUserProperties(profile, 'weather') }
    for (const [key, value] of Object.entries(server)) expect(value).toBe(all[key] ?? '')
  })

  it('only sends parameters the schema actually registers', () => {
    // Same failure the suite above guards: an unregistered param is collected and unreportable.
    const declared = PLAYER_DIMENSIONS.map((d) => d.parameterName)
    for (const key of Object.keys(serverUserProperties(profile, 'weather'))) {
      expect(declared).toContain(key)
    }
  })
})
