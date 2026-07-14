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
  androidChrome:
    'Mozilla/5.0 (Linux; Android 12; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  androidWv:
    'Mozilla/5.0 (Linux; 14; LH5581UHSG-1AG Build/UP1A.231005.007.A1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Safari/537.36',
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

  it('identifies BrightSign, IAdea, LG webOS, Samsung Tizen, Cisco', () => {
    expect(detectPlayer(UA.brightsign, '').vendor).toBe('brightsign')
    expect(detectPlayer(UA.iadea, '').vendor).toBe('iadea')
    expect(detectPlayer(UA.webos, '').vendor).toBe('lg-webos')
    expect(detectPlayer(UA.tizen, '').vendor).toBe('samsung-tizen')
    expect(detectPlayer(UA.roomos, '').vendor).toBe('cisco-roomos')
  })

  it('treats the Teams desktop client UA as a browser, not a meeting room', () => {
    // Teams/ appears in the desktop app UA on ordinary laptops — inferred from referrer instead.
    const p = detectPlayer(UA.teams, '')
    expect(p.vendor).toBeNull()
    expect(p.category).toBe('browser')
  })

  it('infers MS Teams / Google Meet from the meeting referrer', () => {
    expect(detectPlayer(UA.desktopEdge, 'https://teams.microsoft.com/').vendor).toBe('ms-teams')
    expect(detectPlayer(UA.desktopEdge, 'https://meet.google.com/').vendor).toBe('google-meet')
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

  it('does not treat the word AFTER as a Fire TV device', () => {
    const p = detectPlayer('Mozilla/5.0 (Windows NT 10.0) SomeApp AFTER Chrome/120 Safari/537.36', '')
    expect(p.platform).not.toBe('firetv')
    expect(p.category).not.toBe('signage')
  })

  it('classifies ordinary Android mobile Chrome as a browser, not signage', () => {
    const p = detectPlayer(UA.androidChrome, '')
    expect(p.platform).toBe('android')
    expect(p.category).toBe('browser')
  })

  it('classifies a genuine Android WebView app (; wv) as signage', () => {
    const p = detectPlayer(UA.androidWv, '')
    expect(p.platform).toBe('android-webview')
    expect(p.category).toBe('signage')
  })
})

describe('detectPlayer — engine, belowFloor, model', () => {
  it('flags BrightSign Chrome 65 as below the floor and reads its model', () => {
    const p = detectPlayer(UA.brightsign, '')
    expect(p.engine).toEqual({ name: 'qtwebengine', version: 65 })
    expect(p.belowFloor).toBe(true)
    expect(p.model).toBe('XT1144')
  })

  it('reads the LS424 model from a spaced BrightSign UA', () => {
    const p = detectPlayer(
      'BrightSign/8.5.33 (XD234) Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) QtWebEngine/5.15.2 Chrome/87.0.4280.144 Safari/537.36',
      '',
    )
    expect(p.model).toBe('XD234')
    expect(p.belowFloor).toBe(false) // Chrome 87 == floor
  })

  it('marks bare QtWebEngine Chrome 83 below floor (no vendor)', () => {
    const p = detectPlayer(UA.bareQt, '')
    expect(p.engine).toEqual({ name: 'qtwebengine', version: 83 })
    expect(p.belowFloor).toBe(true)
  })

  it('marks current Anthias (Chrome 122) at/above floor', () => {
    const p = detectPlayer(UA.anthias, '')
    expect(p.engine.version).toBe(122)
    expect(p.belowFloor).toBe(false)
  })

  it('flags a legacy WebKit viewer (Version/8.0) below floor', () => {
    const p = detectPlayer(
      'Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/538.15 (KHTML, like Gecko) Version/8.0 Safari/538.15',
      '',
    )
    expect(p.engine.name).toBe('webkit')
    expect(p.engine.version).toBe(8)
    expect(p.belowFloor).toBe(true)
  })

  it('reads the Android Build model and Fire TV model', () => {
    expect(detectPlayer(UA.iadea, '').model).toContain('MBR-1100')
    expect(detectPlayer(UA.yodeckFiretv, '').model).toBe('AFTM')
  })

  it('classifies Firefox by Gecko version', () => {
    const p = detectPlayer('Mozilla/5.0 (X11; Linux x86_64; rv:152.0) Gecko/20100101 Firefox/152.0', '')
    expect(p.engine).toEqual({ name: 'gecko', version: 152 })
    expect(p.belowFloor).toBe(false)
  })

  it('leaves engine null / belowFloor null for a non-engine client', () => {
    const p = detectPlayer(UA.curl, '')
    expect(p.engine).toEqual({ name: null, version: null })
    expect(p.belowFloor).toBeNull()
  })
})

describe('detectPlayer — robustness', () => {
  it('is prototype-pollution safe on X-Requested-With', () => {
    for (const evil of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
      const p = detectPlayer(UA.androidChrome, '', evil)
      expect(p.vendor).toBeNull()
      expect(p.category).toBe('browser') // defined, never undefined
      expect(vendorFromPackage(evil)).toBeNull()
    }
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

  it('does not match look-alike hosts (dot boundary)', () => {
    expect(detectPlayer(UA.bareQt, 'https://evilyodeck.com/').vendor).toBeNull()
    // an unrelated host merely ending in srly.io must NOT be treated as an app host
    expect(detectPlayer(UA.bareQt, 'https://player.yodeck.com.notsrly.io/').vendor).toBeNull()
  })

  it('recovers a schemeless referrer with a path', () => {
    expect(detectPlayer(UA.bareQt, 'player.yodeck.com/display/123').vendor).toBe('yodeck')
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

  it('defaults platform to android-webview for a package with no UA/referrer platform', () => {
    const p = detectPlayer('', '', 'com.pisignage.player2')
    expect(p.vendor).toBe('pisignage')
    expect(p.platform).toBe('android-webview')
  })

  it('infers android-webview from an unknown package and records the source', () => {
    const p = detectPlayer('', '', 'com.unknown.player')
    expect(p.vendor).toBeNull()
    expect(p.platform).toBe('android-webview')
    expect(p.sources).toContain('requestedWith')
  })

  it('does not treat X-Requested-With: XMLHttpRequest as an Android WebView', () => {
    const p = detectPlayer(UA.desktopEdge, '', 'XMLHttpRequest')
    expect(p.platform).toBe('windows') // from the UA, not android-webview
    expect(p.category).toBe('browser')
    expect(p.sources).not.toContain('requestedWith')
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

  it('does not throw when navigator is present but userAgent is missing', () => {
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true })
    expect(() => detectPlayer()).not.toThrow()
    const p = detectPlayer()
    expect(p.vendor).toBeNull()
    expect(p.engine).toEqual({ name: null, version: null })
  })
})
