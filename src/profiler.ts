// Signage player profiler. Identifies which player a request comes from, using the
// three signals a signage device leaks: the user agent, the referrer, and (server
// side only) the Android WebView `X-Requested-With` package name.
//
// Built from a traffic sample across the Screenly-Labs apps. Two hard rules baked in
// from that analysis:
//   * Anthias is only claimed when the UA carries the `Anthias/` product token — the
//     large bare-`QtWebEngine` bucket is the same engine but is NOT attributed to it.
//   * Screenly reuses the existing `screenly-viewer` check from ./branding, enriched
//     to also catch `ScreenlyWebview` and the versioned `screenly-viewer/2.0`.
//
// At runtime a page can only read `navigator.userAgent` and `document.referrer`; a
// request's own headers are not exposed to page JS, so the `requestedWith` argument
// is for server-side callers (Workers/SSR) that do have the header.

/** Known player / device vendors. */
export type PlayerVendor =
  | 'screenly'
  | 'anthias'
  | 'brightsign'
  | 'yodeck'
  | 'pisignage'
  | 'xogo'
  | 'iadea'
  | 'slideshow'
  | 'ablesign'
  | 'harison'
  | 'concerto'
  | 'unifi-connect'
  | 'lg-webos'
  | 'samsung-tizen'
  | 'zoom'
  | 'cisco-roomos'
  | 'google-meet'
  | 'ms-teams'

/** Underlying hardware / OS platform, when the vendor is unknown or as extra context. */
export type PlayerPlatform =
  | 'firetv'
  | 'android-tv'
  | 'android-webview'
  | 'chromeos'
  | 'raspberry-pi'
  | 'webos'
  | 'tizen'
  | 'windows'
  | 'macos'
  | 'ios'
  | 'linux'

/** What kind of client this is. */
export type PlayerCategory = 'signage' | 'meeting-room' | 'browser' | 'bot'

export type Confidence = 'high' | 'medium' | 'low'

/** Which of the three input signals contributed to the profile. */
export type ProfileSource = 'userAgent' | 'referrer' | 'requestedWith'

export interface PlayerProfile {
  /** The identified vendor, or `null` when only a platform (or nothing) could be determined. */
  vendor: PlayerVendor | null
  /** The hardware/OS platform, or `null` when it could not be determined. */
  platform: PlayerPlatform | null
  category: PlayerCategory
  confidence: Confidence
  /** The signals that contributed, e.g. `['userAgent', 'referrer']`. */
  sources: ProfileSource[]
}

// --- signature tables --------------------------------------------------------

/** Category for each known vendor — single source of truth. */
const VENDOR_CATEGORY: Record<PlayerVendor, PlayerCategory> = {
  screenly: 'signage',
  anthias: 'signage',
  brightsign: 'signage',
  yodeck: 'signage',
  pisignage: 'signage',
  xogo: 'signage',
  iadea: 'signage',
  slideshow: 'signage',
  ablesign: 'signage',
  harison: 'signage',
  concerto: 'signage',
  'unifi-connect': 'signage',
  'lg-webos': 'signage',
  'samsung-tizen': 'signage',
  zoom: 'meeting-room',
  'cisco-roomos': 'meeting-room',
  'google-meet': 'meeting-room',
  'ms-teams': 'meeting-room',
}

/**
 * Android `X-Requested-With` package name -> vendor. Only usable server-side (the
 * header is not visible to page JS). Also the reference map for the header dump.
 */
export const PACKAGE_VENDORS: Record<string, PlayerVendor> = {
  'xogo.xogoplayer': 'xogo',
  'com.pisignage.player2': 'pisignage',
  'tv.ablesign.app': 'ablesign',
  'com.iadea.player': 'iadea',
  // Yodeck's Fire OS build ships with Android's `com.example.*` placeholder namespace;
  // this is the exact id observed in traffic, not a stand-in for a "real" package.
  'com.example.yodeck_fireos': 'yodeck',
  'sk.mimac.slideshow': 'slideshow',
  'com.harison.adver': 'harison',
  'us.zoom.zoompresence': 'zoom',
  'com.google.android.apps.notrod.webviewapp': 'google-meet',
}

/**
 * Screenly player UA tokens — the original `screenly-viewer` check, enriched to also
 * match `ScreenlyWebview` and (via the shared `-viewer` token) `screenly-viewer/2.0`.
 * Case-sensitive on purpose: these are the exact tokens devices emit, and `./branding`
 * reuses this constant so `isScreenlyPlayer()` stays a single cheap regex test.
 */
export const SCREENLY_UA = /screenly-viewer|ScreenlyWebview/

// UA product tokens -> vendor (first match wins). Ordered most-specific first.
const UA_VENDORS: ReadonlyArray<readonly [RegExp, PlayerVendor, Confidence]> = [
  [SCREENLY_UA, 'screenly', 'high'],
  [/Anthias\//, 'anthias', 'high'], // ONLY on the explicit token — never inferred
  [/BrightSign\//, 'brightsign', 'high'],
  [/A-SMIL|ADAPI/, 'iadea', 'high'], // IAdea's SMIL signage API
  [/Slideshow\//, 'slideshow', 'high'],
  [/GoogleMeetRoomDeviceWebViewApp/, 'google-meet', 'high'],
  [/\bTeams\//, 'ms-teams', 'high'],
  [/RoomOS/, 'cisco-roomos', 'high'],
  [/Unifi-Connect/i, 'unifi-connect', 'high'],
  [/WebAppManager|NetCast/, 'lg-webos', 'high'],
  [/SMART-TV.*Tizen|Tizen.*\bTV\b/i, 'samsung-tizen', 'medium'],
  // AZR-DS: inferred from an exact traffic-count correlation with the
  // us.zoom.zoompresence package. Unverified — hence low confidence.
  [/AZR-DS/, 'zoom', 'low'],
]

// UA platform tokens -> platform (first match wins). Order matters: Fire TV and
// Chrome OS UAs also contain generic Android/Linux markers, so they come first.
const UA_PLATFORMS: ReadonlyArray<readonly [RegExp, PlayerPlatform]> = [
  // Amazon device model id in the Build position (e.g. `AFTKA Build/…`). The `Build/`
  // anchor keeps ordinary all-caps words like `AFTER` from matching.
  [/\bAFT[A-Z0-9]{1,6}\s+Build\//, 'firetv'],
  [/\bCrOS\b/, 'chromeos'],
  [/Raspbian/, 'raspberry-pi'],
  [/Web0S|webOS|NetCast/i, 'webos'],
  [/Tizen/, 'tizen'],
  [/onn\.|Chromecast|Realtek|Smart TV|Google TV/i, 'android-tv'],
  [/Android/i, 'android-webview'],
  [/Windows NT/, 'windows'],
  [/iPhone|iPad|iPod/, 'ios'],
  [/Macintosh|Mac OS X/, 'macos'],
  [/X11|Linux|Ubuntu/, 'linux'],
]

const UA_BOT =
  /bot\b|crawler|spider|slurp|curl|wget|python-requests|Go-http-client|HeadlessChrome|PhantomJS|GPTBot|ClaudeBot|Applebot|AdsBot-Google|GoogleOther|Googlebot|bingbot|BitSightBot|Bytespider|pathscan|Palo Alto Networks|Cortex-Xpanse|StatusCake|CMS-Checker|facebookexternalhit|Lavf|AppleCoreMedia|Amazon Music/i

// Ordinary personal-computing platforms. Any other recognised platform is treated as a
// signage-capable device when no vendor is identified — so a new signage platform added
// to PlayerPlatform / UA_PLATFORMS defaults to signage without a second list to update.
const BROWSER_PLATFORMS: ReadonlySet<PlayerPlatform> = new Set<PlayerPlatform>([
  'windows',
  'macos',
  'ios',
  'linux',
])

// --- classifiers -------------------------------------------------------------

interface UaClass {
  vendor: PlayerVendor | null
  vendorConfidence: Confidence
  platform: PlayerPlatform | null
  isBot: boolean
  hasQtWebEngine: boolean
}

const classifyUserAgent = (ua: string): UaClass => {
  let vendor: PlayerVendor | null = null
  let vendorConfidence: Confidence = 'low'
  for (const [re, v, c] of UA_VENDORS) {
    if (re.test(ua)) {
      vendor = v
      vendorConfidence = c
      break
    }
  }
  let platform: PlayerPlatform | null = null
  for (const [re, p] of UA_PLATFORMS) {
    if (re.test(ua)) {
      platform = p
      break
    }
  }
  return {
    vendor,
    vendorConfidence,
    platform,
    // A recognised vendor is never a bot even if its UA trips a generic pattern.
    isBot: vendor === null && UA_BOT.test(ua),
    hasQtWebEngine: /QtWebEngine/.test(ua),
  }
}

interface RefClass {
  vendor: PlayerVendor | null
  vendorConfidence: Confidence
  platform: PlayerPlatform | null
}

const hostnameOf = (referrer: string): string => {
  if (!referrer) return ''
  const parse = (s: string): string | null => {
    try {
      return new URL(s).hostname.toLowerCase()
    } catch {
      return null
    }
  }
  // Retry with a scheme so a schemeless referrer with a path (`host.com/x`) still parses.
  return parse(referrer) ?? parse(`https://${referrer}`) ?? ''
}

// True when `host` is `domain` or a subdomain of it — the dot boundary stops
// `evilyodeck.com` from matching `yodeck.com` or `notsrly.io` from matching `srly.io`.
const hostMatches = (host: string, domain: string): boolean =>
  host === domain || host.endsWith(`.${domain}`)

const classifyReferrer = (referrer: string): RefClass => {
  const none: RefClass = { vendor: null, vendorConfidence: 'low', platform: null }
  const host = hostnameOf(referrer)
  if (!host) return none
  // Screenly's own app hosts identify the *content*, not the player — no signal.
  if (hostMatches(host, 'srly.io') || hostMatches(host, 'screenly.io')) return none
  if (hostMatches(host, 'yodeck.com')) return { vendor: 'yodeck', vendorConfidence: 'high', platform: null }
  if (hostMatches(host, 'pisignage.com'))
    return { vendor: 'pisignage', vendorConfidence: 'high', platform: null }
  if (hostMatches(host, 'concerto-signage.org'))
    return { vendor: 'concerto', vendorConfidence: 'high', platform: null }
  if (host === 'meet.google.com') return { vendor: 'google-meet', vendorConfidence: 'high', platform: null }
  if (host === 'teams.microsoft.com') return { vendor: 'ms-teams', vendorConfidence: 'high', platform: null }
  if (host === 'appassets.androidplatform.net')
    return { vendor: null, vendorConfidence: 'low', platform: 'android-webview' }
  return none
}

// --- public API --------------------------------------------------------------

const CONFIDENCE_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 }

/**
 * Profile the player behind a request from its user agent, referrer, and (server
 * side) `X-Requested-With` package. Called with no arguments in the browser it reads
 * `navigator.userAgent` and `document.referrer`; both are safe when absent (SSR /
 * Workers). Pass `requestedWith` only where the request header is actually available.
 */
export const detectPlayer = (
  userAgent: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  referrer: string = typeof document !== 'undefined' ? document.referrer : '',
  requestedWith?: string,
): PlayerProfile => {
  const ua = classifyUserAgent(userAgent)
  const ref = classifyReferrer(referrer)
  const pkgVendor = requestedWith ? (PACKAGE_VENDORS[requestedWith] ?? null) : null

  // Resolve the vendor from every signal that produced one, picking the highest
  // confidence. Two independent signals agreeing on a vendor upgrades it to high.
  const candidates: Array<{ vendor: PlayerVendor; confidence: Confidence }> = []
  if (pkgVendor) candidates.push({ vendor: pkgVendor, confidence: 'high' })
  if (ua.vendor) candidates.push({ vendor: ua.vendor, confidence: ua.vendorConfidence })
  if (ref.vendor) candidates.push({ vendor: ref.vendor, confidence: ref.vendorConfidence })

  let vendor: PlayerVendor | null = null
  let confidence: Confidence = 'low'
  if (candidates.length > 0) {
    const winner = candidates.reduce((best, c) =>
      CONFIDENCE_RANK[c.confidence] > CONFIDENCE_RANK[best.confidence] ? c : best,
    )
    vendor = winner.vendor
    confidence = winner.confidence
    if (candidates.filter((c) => c.vendor === vendor).length >= 2) confidence = 'high'
  }

  const platform = ua.platform ?? ref.platform ?? null

  // Category, and the confidence for the vendor-less cases.
  let category: PlayerCategory
  if (vendor) {
    category = VENDOR_CATEGORY[vendor]
  } else if (ua.isBot) {
    category = 'bot'
    confidence = 'high'
  } else if (platform && !BROWSER_PLATFORMS.has(platform)) {
    category = 'signage'
    confidence = 'low' // platform-only: signage-capable device, unknown app
  } else if (ua.hasQtWebEngine) {
    category = 'signage' // Screenly/Anthias engine, untagged — never attributed to Anthias
    confidence = 'low'
  } else if (platform) {
    category = 'browser'
    confidence = 'medium'
  } else {
    category = 'browser'
    confidence = 'low'
  }

  const sources: ProfileSource[] = []
  if (pkgVendor) sources.push('requestedWith')
  if (ua.vendor || ua.platform || ua.isBot || ua.hasQtWebEngine) sources.push('userAgent')
  if (ref.vendor || ref.platform) sources.push('referrer')

  return { vendor, platform, category, confidence, sources }
}

/** X-Requested-With package name -> vendor (server-side helper). `null` if unknown. */
export const vendorFromPackage = (requestedWith: string): PlayerVendor | null =>
  PACKAGE_VENDORS[requestedWith] ?? null

/**
 * Profile the player from an incoming request's headers — the server-side entry point
 * for Cloudflare Workers / SSR, where all three signals are available on the request:
 * `User-Agent`, `Referer`, and the Android WebView `X-Requested-With` package. Accepts
 * anything with a `Headers` (a `Request`, or a Hono `c.req.raw`).
 *
 * Prefer this over the no-argument `detectPlayer()` on the server: in a Worker the
 * `navigator`/`document` globals describe the Worker runtime, not the visitor (e.g.
 * `navigator.userAgent` is `"Cloudflare-Workers"`), so the no-arg form would profile
 * the wrong thing.
 */
export const detectPlayerFromRequest = (request: { headers: Headers }): PlayerProfile => {
  const { headers } = request
  return detectPlayer(
    headers.get('user-agent') ?? '',
    headers.get('referer') ?? '',
    headers.get('x-requested-with') ?? undefined,
  )
}
