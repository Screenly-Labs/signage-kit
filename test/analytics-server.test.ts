import { describe, expect, it } from 'bun:test'
import {
  PLAYER_PROFILE_HEADERS,
  PLAYER_PROFILE_PATH,
  playerProfileFromRequest,
  playerProfileResponse
} from '../src/analytics-server'
import { gaClientIdFrom, hashDeviceId } from '../src/screenly-metadata'

const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) })

// The Yodeck Fire OS package: a UA-only profile cannot name this vendor, the header can.
const YODECK = { 'user-agent': 'Mozilla/5.0 (Linux; Android 9; AFTKA Build/x) Chrome/120 Mobile Safari/537.36', 'x-requested-with': 'com.example.yodeck_fireos' }

// A Screenly player with "Send metadata" on. The device id is the only stable per-screen
// identifier in the system, since GA4's cookie-based client_id does not survive on these players.
const SCREENLY_META = {
  'user-agent': 'Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) screenly-viewer Safari/537.36',
  'x-screenly-hostname': 'srly-jmar75ko6xp651j',
  'x-screenly-hardware': 'x86',
  'x-screenly-version': 'v2',
  'x-screenly-screen-name': 'dizzy cherry',
  'x-screenly-location-name': 'Cape Town',
  'x-screenly-lat': '-33.925278',
  'x-screenly-lng': '18.423889',
  'x-screenly-tags': 'srly-jmar75ko6xp651j,custom-label'
}

describe('playerProfileFromRequest', () => {
  it('names an Android WebView vendor that the user agent alone cannot', async () => {
    const withHeader = await playerProfileFromRequest(req(YODECK))
    const withoutHeader = await playerProfileFromRequest(req({ 'user-agent': YODECK['user-agent'] }))
    expect(withHeader.vendor).toBe('yodeck')
    expect(withoutHeader.vendor).toBeNull()
  })

  it('records requestedWith as a contributing source', async () => {
    expect((await playerProfileFromRequest(req(YODECK))).sources).toContain('requestedWith')
  })
})

describe('Screenly metadata', () => {
  it('hashes the device id and never exposes the raw one', async () => {
    const profile = await playerProfileFromRequest(req(SCREENLY_META))
    expect(profile.deviceId).toBe(await hashDeviceId('srly-jmar75ko6xp651j'))
    expect(profile.deviceId).not.toBe('srly-jmar75ko6xp651j')
    // The whole serialised profile must not carry the raw id anywhere.
    expect(JSON.stringify(profile)).not.toContain('srly-jmar75ko6xp651j')
  })

  it('keeps the device key inside the 36-char user-property cap', async () => {
    const { deviceId } = await playerProfileFromRequest(req(SCREENLY_META))
    expect(deviceId).not.toBeNull()
    expect((deviceId as string).length).toBe(32)
  })

  it('is stable for the same device and different for another', async () => {
    const a = await playerProfileFromRequest(req(SCREENLY_META))
    const b = await playerProfileFromRequest(req(SCREENLY_META))
    const other = await playerProfileFromRequest(
      req({ ...SCREENLY_META, 'x-screenly-hostname': 'srly-someotherdevice1' })
    )
    expect(a.deviceId).toBe(b.deviceId) // stability is the entire point
    expect(other.deviceId).not.toBe(a.deviceId)
  })

  it('changes the hash when a salt is supplied', async () => {
    const unsalted = await playerProfileFromRequest(req(SCREENLY_META))
    const salted = await playerProfileFromRequest(req(SCREENLY_META), { salt: 'pepper' })
    expect(salted.deviceId).not.toBe(unsalted.deviceId)
    expect(salted.deviceId).toBe(await hashDeviceId('srly-jmar75ko6xp651j', 'pepper'))
  })

  it('names the vendor from metadata even with no UA token', async () => {
    // An integrator can strip the UA product token; they cannot send this header set.
    const profile = await playerProfileFromRequest(
      req({ 'user-agent': 'Mozilla/5.0 (X11; Linux armv7l) CustomKiosk/1.0', 'x-screenly-hardware': 'x86' })
    )
    expect(profile.vendor).toBe('screenly')
    expect(profile.confidence).toBe('high')
  })

  it('fills the model from hardware, which the Screenly UA never carries', async () => {
    const withMeta = await playerProfileFromRequest(req(SCREENLY_META))
    const withoutMeta = await playerProfileFromRequest(req({ 'user-agent': SCREENLY_META['user-agent'] }))
    expect(withMeta.model).toBe('x86')
    expect(withoutMeta.model).toBeNull()
  })

  it('lets a UA-parsed model win over the coarse hardware string', async () => {
    // A BrightSign XT1144 is more specific than an architecture, so the UA keeps precedence.
    const profile = await playerProfileFromRequest(
      req({
        'user-agent': 'BrightSign/8.0.94 (XT1144) Mozilla/5.0 (X11; Linux aarch64) QtWebEngine/5.11.2 Chrome/65 Safari/537.36',
        'x-screenly-hardware': 'x86'
      })
    )
    expect(profile.model).toBe('XT1144')
  })

  it('reports the player generation without touching the support floor', async () => {
    const profile = await playerProfileFromRequest(req(SCREENLY_META))
    expect(profile.swVersion).toBe('v2')
    // v2 says nothing about which Chromium ships inside, and this UA has no version token.
    expect(profile.belowFloor).toBeNull()
  })

  it('records whether metadata was present, and distinguishes it from absent', async () => {
    expect((await playerProfileFromRequest(req(SCREENLY_META))).hasMetadata).toBe(true)
    expect((await playerProfileFromRequest(req(YODECK))).hasMetadata).toBe(false)
  })

  it('ignores premises-identifying metadata entirely', async () => {
    const serialised = JSON.stringify(await playerProfileFromRequest(req(SCREENLY_META)))
    for (const leak of ['dizzy cherry', 'Cape Town', '-33.925278', '18.423889', 'custom-label']) {
      expect(serialised).not.toContain(leak)
    }
  })

  it('treats an empty or absurd header as absent', async () => {
    const empty = await playerProfileFromRequest(req({ 'x-screenly-hostname': '   ' }))
    expect(empty.deviceId).toBeNull()
    expect(empty.hasMetadata).toBe(false)

    const huge = await playerProfileFromRequest(req({ 'x-screenly-hardware': 'x'.repeat(500) }))
    expect(huge.model).toBeNull()
    expect(huge.hasMetadata).toBe(false)
  })
})

describe('playerProfileResponse', () => {
  it('serves the profile as JSON', async () => {
    const res = await playerProfileResponse(req(YODECK))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect((await res.json()).vendor).toBe('yodeck')
  })

  it('is uncacheable, or every screen inherits the first screen identity', async () => {
    const cc = (await playerProfileResponse(req(YODECK))).headers.get('cache-control') ?? ''
    expect(cc).toContain('no-store')
    expect(cc).toContain('max-age=0')
  })

  it('varies on the signals it reads', async () => {
    const vary = (await playerProfileResponse(req(YODECK))).headers.get('vary') ?? ''
    expect(vary).toContain('x-requested-with')
  })

  it('never serialises the raw device id into the response body', async () => {
    // The response is the only thing that leaves the Worker, so this is the assertion that
    // actually enforces the privacy boundary.
    const body = await (await playerProfileResponse(req(SCREENLY_META))).text()
    expect(body).not.toContain('srly-jmar75ko6xp651j')
    expect(body).toContain(await hashDeviceId('srly-jmar75ko6xp651j'))
  })

  it('exposes a shared path so apps do not diverge', () => {
    expect(PLAYER_PROFILE_PATH).toBe('/api/player')
    expect(PLAYER_PROFILE_HEADERS['cache-control']).toContain('no-store')
  })
})

describe('GA4 client_id pinned to the device', () => {
  it('derives a client_id from the same hash, so the two always agree', async () => {
    const profile = await playerProfileFromRequest(req(SCREENLY_META))
    const hash = await hashDeviceId('srly-jmar75ko6xp651j')
    expect(profile.deviceId).toBe(hash)
    expect(profile.gaClientId).toBe(gaClientIdFrom(hash))
  })

  it('is THE SAME for a device across requests, which is the entire point', async () => {
    // Storage wipes are what break GA4's own client_id. This value is derived, not stored, so
    // it cannot be wiped.
    const first = await playerProfileFromRequest(req(SCREENLY_META))
    const second = await playerProfileFromRequest(req(SCREENLY_META))
    expect(first.gaClientId).toBe(second.gaClientId)
  })

  it('differs between devices', async () => {
    const a = await playerProfileFromRequest(req(SCREENLY_META))
    const b = await playerProfileFromRequest(
      req({ ...SCREENLY_META, 'x-screenly-hostname': 'srly-adifferentdevice' })
    )
    expect(a.gaClientId).not.toBe(b.gaClientId)
  })

  it('looks like a client_id GA4 generated itself', async () => {
    // <uint32>.<uint32>, matching GA4's native shape, so nothing in the pipeline is tempted to
    // normalise or reject it.
    const { gaClientId } = await playerProfileFromRequest(req(SCREENLY_META))
    expect(gaClientId).toMatch(/^\d+\.\d+$/)
    const [high, low] = (gaClientId as string).split('.').map(Number)
    for (const part of [high, low]) {
      expect(Number.isInteger(part)).toBe(true)
      expect(part).toBeGreaterThanOrEqual(0)
      expect(part).toBeLessThanOrEqual(0xffffffff)
    }
  })

  it('is null when there is no device id, so the snippet falls back to GA4 defaults', async () => {
    expect((await playerProfileFromRequest(req(YODECK))).gaClientId).toBeNull()
  })

  it('never leaks the raw device id through the new field either', async () => {
    const body = await (await playerProfileResponse(req(SCREENLY_META))).text()
    expect(body).not.toContain('srly-jmar75ko6xp651j')
    expect(body).toContain('"gaClientId"')
  })
})

// Without these the first page view of every new client_id carries no player fields, and on a
// player that starts each load with fresh storage that is every page view it will ever send.
describe('user properties for the first page view', () => {
  it('adds them to the payload when the caller names its app', async () => {
    const profile = await playerProfileFromRequest(req(YODECK), { app: 'clock' })
    expect(profile.userProperties?.player_vendor).toBe('yodeck')
    expect(profile.userProperties?.player_app).toBe('clock')
  })

  it('omits them entirely when no app is named, rather than guessing', async () => {
    // An app that has not opted in keeps exactly the old payload, and never ships
    // player_app "unknown" to GA4 because an argument was forgotten.
    const profile = await playerProfileFromRequest(req(YODECK))
    expect(profile.userProperties).toBeUndefined()
  })

  it('leaves out the fields that need a DOM, instead of sending the unknown sentinel', async () => {
    // trackPlayer probes and sets these a moment later. Padding them here would fill the
    // "we could not tell" buckets with rows that had merely not been measured yet.
    const profile = await playerProfileFromRequest(req(YODECK), { app: 'clock' })
    const keys = Object.keys(profile.userProperties ?? {})
    expect(keys).not.toContain('player_degraded')
    expect(keys).not.toContain('player_degraded_reason')
    expect(keys).not.toContain('player_css_support')
    expect(keys).toContain('player_engine')
  })

  it('carries the header-only vendor, which is the whole reason the server profiles', async () => {
    const profile = await playerProfileFromRequest(req(YODECK), { app: 'clock' })
    expect(profile.userProperties?.player_sources).toContain('requestedWith')
  })

  it('serves them over the route too, not just the plain-object entry point', async () => {
    const response = await playerProfileResponse(req(YODECK), { app: 'clock' })
    const body = (await response.json()) as { userProperties?: Record<string, string> }
    expect(body.userProperties?.player_vendor).toBe('yodeck')
    // Still uncacheable: this response now carries per-screen identity AND its properties.
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('agrees with the device id it ships alongside', async () => {
    const profile = await playerProfileFromRequest(req(SCREENLY_META), { app: 'weather' })
    expect(profile.userProperties?.player_device).toBe(profile.deviceId ?? '')
    expect(profile.userProperties?.player_metadata).toBe('true')
  })
})
