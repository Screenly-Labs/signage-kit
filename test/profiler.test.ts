import { describe, expect, it, afterEach } from 'bun:test'
import { detectPlayer, detectPlayerFromRequest, vendorFromPackage, PACKAGE_VENDORS } from '../src/profiler'

// Real UAs sampled from the Screenly-Labs traffic dumps.
const UA = {
  anthias:
    'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) QtWebEngine/6.8.2 Chrome/122.0.6261.171 Safari/537.36 Anthias/2026.7.1',
  bareQt:
    'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) QtWebEngine/5.15.2 Chrome/83.0.4103.122 Safari/537.36',
  screenlyViewer:
    'Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) screenly-viewer Safari/537.36',
  screenlyWebview: 'Mozilla/5.0 (Unknown; Linux) AppleWebKit/538.1 (KHTML, like Gecko) ScreenlyWebview Safari/538.1',
  screenlyV2: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537.36 screenly-viewer/2.0',
  brightsign:
    'BrightSign/UJE9C2001890/8.0.94 (XT1144)Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) QtWebEngine/5.11.2 Chrome/65.0.3325.230 Safari/537.36',
  iadea:
    'Mozilla/5.0 (Linux; Android 7.1.1; MBR-1100 Rev1.1 A7 Build/NMF26X; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/68.0.3440.70 Safari/537.36 ADAPI/2.0.0 (UUID:x) RK3188-ADAPI/2.2.1-96 (MODEL:MBR-1100) A-SMIL/1.0.0-17',
  slideshowFiretv:
    'Mozilla/5.0 (Linux; Android 11; AFTKRT Build/RS8174.3648N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/146.0.7680.165 Mobile Safari/537.36 Slideshow/4.8.1',
  yodeckFiretv:
    'Mozilla/5.0 (Linux; Android 5.1.1; AFTM Build/LVY48F; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.5359.160 Mobile Safari/537.36',
  xogoFiretv:
    'Mozilla/5.0 (Linux; Android 9; AFTKA Build/PS7713.5443N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.7204.244 Mobile Safari/537.36',
  chromeos:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  tizen:
    'Mozilla/5.0 (SMART-TV; LINUX; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) 94.0.4606.31/7.0 TV Safari/537.36',
  webos:
    'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 WebAppManager',
  roomos:
    'Mozilla/5.0 (Linux; RoomOS; Cisco Desk Pro) AppleWebKit/537.36 (KHTML, like Gecko) QtWebEngine/6.10.3 Chrome/134.0.6998.208 Safari/537.36',
  teams:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0 Teams/26058.705.4475.8348/51',
  desktopEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
  curl: 'curl/8.14.1',
  gptbot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.4; +https://openai.com/gptbot)',
} as const

describe('detectPlayer — UA vendor tokens', () => {
  it('identifies Anthias only from the Anthias/ token', () => {
    const p = detectPlayer(UA.anthias, '')
    expect(p.vendor).toBe('anthias')
    expect(p.category).toBe('signage')
    expect(p.confidence).toBe('high')
  })

  it('does NOT attribute bare QtWebEngine to Anthias', () => {
    const p = detectPlayer(UA.bareQt, '')
    expect(p.vendor).toBeNull()
    expect(p.category).toBe('signage')
    expect(p.confidence).toBe('low')
  })

  it('identifies Screenly across all three UA variants', () => {
    expect(detectPlayer(UA.screenlyViewer, '').vendor).toBe('screenly')
    expect(detectPlayer(UA.screenlyWebview, '').vendor).toBe('screenly')
    expect(detectPlayer(UA.screenlyV2, '').vendor).toBe('screenly')
  })

  it('identifies BrightSign, IAdea, LG webOS, Samsung Tizen, Cisco, Teams', () => {
    expect(detectPlayer(UA.brightsign, '').vendor).toBe('brightsign')
    expect(detectPlayer(UA.iadea, '').vendor).toBe('iadea')
    expect(detectPlayer(UA.webos, '').vendor).toBe('lg-webos')
    expect(detectPlayer(UA.tizen, '').vendor).toBe('samsung-tizen')
    expect(detectPlayer(UA.roomos, '').vendor).toBe('cisco-roomos')
    const teams = detectPlayer(UA.teams, '')
    expect(teams.vendor).toBe('ms-teams')
    expect(teams.category).toBe('meeting-room')
  })

  it('reads platform alongside a UA vendor token (Slideshow on Fire TV)', () => {
    const p = detectPlayer(UA.slideshowFiretv, '')
    expect(p.vendor).toBe('slideshow')
    expect(p.platform).toBe('firetv')
  })
})

describe('detectPlayer — platform-only (unknown app)', () => {
  it('reports Fire TV with no vendor for an untagged app', () => {
    const p = detectPlayer(UA.yodeckFiretv, '')
    expect(p.vendor).toBeNull()
    expect(p.platform).toBe('firetv')
    expect(p.category).toBe('signage')
    expect(p.confidence).toBe('low')
  })

  it('reports Chrome OS', () => {
    expect(detectPlayer(UA.chromeos, '').platform).toBe('chromeos')
  })
})

describe('detectPlayer — referrer recovers runtime blind spots', () => {
  it('recovers Yodeck from player.yodeck.com over a generic Fire TV UA', () => {
    const p = detectPlayer(UA.yodeckFiretv, 'https://player.yodeck.com/')
    expect(p.vendor).toBe('yodeck')
    expect(p.platform).toBe('firetv') // platform still from UA
    expect(p.confidence).toBe('high')
    expect(p.sources).toEqual(['userAgent', 'referrer'])
  })

  it('recovers piSignage from pisignage.com (no UA token at all)', () => {
    const p = detectPlayer(UA.bareQt, 'https://pisignage.com/')
    expect(p.vendor).toBe('pisignage')
    expect(p.sources).toContain('referrer')
  })

  it('ignores Screenly app referrers (identify content, not player)', () => {
    const p = detectPlayer(UA.bareQt, 'https://weather.srly.io/')
    expect(p.vendor).toBeNull()
    expect(p.sources).not.toContain('referrer')
  })
})

describe('detectPlayer — three-way corroboration & headers', () => {
  it('upgrades to high when two signals agree on the vendor', () => {
    const p = detectPlayer(UA.slideshowFiretv, '', 'sk.mimac.slideshow')
    expect(p.vendor).toBe('slideshow')
    expect(p.confidence).toBe('high')
    expect(p.sources).toEqual(['requestedWith', 'userAgent'])
  })

  it('resolves the vendor from the X-Requested-With package alone', () => {
    const p = detectPlayer(UA.xogoFiretv, '', 'xogo.xogoplayer')
    expect(p.vendor).toBe('xogo')
    expect(p.platform).toBe('firetv')
  })

  it('vendorFromPackage maps known packages and null otherwise', () => {
    expect(vendorFromPackage('com.pisignage.player2')).toBe('pisignage')
    expect(vendorFromPackage('com.unknown.app')).toBeNull()
    expect(Object.keys(PACKAGE_VENDORS).length).toBeGreaterThan(0)
  })
})

describe('detectPlayerFromRequest — server-side (Workers/SSR)', () => {
  const req = (h: Record<string, string>) => ({ headers: new Headers(h) })

  it('factors in X-Requested-With when the request carries it', () => {
    const p = detectPlayerFromRequest(
      req({
        'user-agent': UA.xogoFiretv,
        'x-requested-with': 'xogo.xogoplayer',
      }),
    )
    expect(p.vendor).toBe('xogo') // recovered from the header — invisible at runtime
    expect(p.platform).toBe('firetv')
    expect(p.sources).toContain('requestedWith')
  })

  it('degrades gracefully to UA + referer when no header is present', () => {
    const p = detectPlayerFromRequest(
      req({ 'user-agent': UA.yodeckFiretv, referer: 'https://player.yodeck.com/' }),
    )
    expect(p.vendor).toBe('yodeck')
    expect(p.sources).toEqual(['userAgent', 'referrer'])
  })

  it('handles an empty request without throwing', () => {
    const p = detectPlayerFromRequest(req({}))
    expect(p.vendor).toBeNull()
  })
})

describe('detectPlayer — non-players', () => {
  it('classifies desktop browsers', () => {
    const p = detectPlayer(UA.desktopEdge, '')
    expect(p.vendor).toBeNull()
    expect(p.category).toBe('browser')
    expect(p.platform).toBe('windows')
  })

  it('classifies bots', () => {
    expect(detectPlayer(UA.curl, '').category).toBe('bot')
    expect(detectPlayer(UA.gptbot, '').category).toBe('bot')
  })
})

describe('detectPlayer — global fallbacks', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original)
    else Reflect.deleteProperty(globalThis, 'navigator')
  })

  it('reads navigator.userAgent when called with no arguments', () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: UA.anthias },
      configurable: true,
      writable: true,
    })
    expect(detectPlayer().vendor).toBe('anthias')
  })

  it('does not throw when navigator/document are absent', () => {
    Reflect.deleteProperty(globalThis, 'navigator')
    expect(() => detectPlayer()).not.toThrow()
    expect(detectPlayer().vendor).toBeNull()
  })
})
