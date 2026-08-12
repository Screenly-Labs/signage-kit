import { describe, expect, it } from 'bun:test'
import {
  PLAYER_PROFILE_HEADERS,
  PLAYER_PROFILE_PATH,
  playerProfileFromRequest,
  playerProfileResponse
} from '../src/analytics-server'

const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) })

// The Yodeck Fire OS package: a UA-only profile cannot name this vendor, the header can.
const YODECK = { 'user-agent': 'Mozilla/5.0 (Linux; Android 9; AFTKA Build/x) Chrome/120 Mobile Safari/537.36', 'x-requested-with': 'com.example.yodeck_fireos' }

describe('playerProfileFromRequest', () => {
  it('names an Android WebView vendor that the user agent alone cannot', () => {
    const withHeader = playerProfileFromRequest(req(YODECK))
    const withoutHeader = playerProfileFromRequest(req({ 'user-agent': YODECK['user-agent'] }))
    expect(withHeader.vendor).toBe('yodeck')
    expect(withoutHeader.vendor).toBeNull()
  })

  it('records requestedWith as a contributing source', () => {
    expect(playerProfileFromRequest(req(YODECK)).sources).toContain('requestedWith')
  })
})

describe('playerProfileResponse', () => {
  it('serves the profile as JSON', async () => {
    const res = playerProfileResponse(req(YODECK))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect((await res.json()).vendor).toBe('yodeck')
  })

  it('is uncacheable, or every screen inherits the first screen identity', () => {
    const cc = playerProfileResponse(req(YODECK)).headers.get('cache-control') ?? ''
    expect(cc).toContain('no-store')
    expect(cc).toContain('max-age=0')
  })

  it('varies on the signals it reads', () => {
    const vary = playerProfileResponse(req(YODECK)).headers.get('vary') ?? ''
    expect(vary).toContain('x-requested-with')
  })

  it('exposes a shared path so apps do not diverge', () => {
    expect(PLAYER_PROFILE_PATH).toBe('/api/player')
    expect(PLAYER_PROFILE_HEADERS['cache-control']).toContain('no-store')
  })
})
