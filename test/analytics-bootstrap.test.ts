import { describe, expect, it } from 'bun:test'
import { analyticsBootstrap } from '../src/analytics-bootstrap.js'

// Extract and execute the snippet's JS against stubs, so these test the string that actually
// ships rather than a paraphrase of it. Same approach as the gate drift guard.
interface RunResult {
  calls: unknown[][]
  profile: unknown
  /** The pending timeout callback, so a test can fire it deliberately. */
  fireTimeout: (() => void) | null
  cleared: boolean
  /** Re-read dataLayer AFTER firing the timer; `calls` is only a snapshot. */
  readCalls: () => unknown[][]
}

const run = async (
  html: string,
  fetchImpl: (url: string, init?: unknown) => Promise<unknown>
): Promise<RunResult> => {
  const js = html.replace(/^[\s\S]*?<script>/, '').replace(/<\/script>[\s\S]*$/, '')
  const win: Record<string, unknown> = {}
  let pending: (() => void) | null = null
  let cleared = false

  new Function('window', 'fetch', 'setTimeout', 'clearTimeout', js)(
    win,
    fetchImpl,
    (fn: () => void) => {
      // Held rather than fired, so each test controls whether the timeout path runs.
      pending = fn
      return 1
    },
    () => {
      cleared = true
    }
  )

  // Let the fetch chain settle. Three turns covers fetch -> json -> settle.
  for (let i = 0; i < 5; i++) await Promise.resolve()

  const readCalls = () =>
    ((win.dataLayer as unknown[] | undefined) ?? []).map((args) =>
      Array.from(args as ArrayLike<unknown>)
    )
  return { calls: readCalls(), profile: win.__playerProfile, fireTimeout: pending, cleared, readCalls }
}

const configCalls = (calls: unknown[][]) => calls.filter((c) => c[0] === 'config')

describe('analyticsBootstrap — static apps (no profile endpoint)', () => {
  it('configures immediately, with no deferral to pay for', () => {
    const html = analyticsBootstrap({ gaId: 'G-TEST' })
    // Byte-identical to Google's own snippet when there are no params to add.
    expect(html).toContain("gtag('config', 'G-TEST')")
    expect(html).not.toContain('fetch(')
  })

  it('still carries app config params when it has them', () => {
    const html = analyticsBootstrap({ gaId: 'G-TEST', configParams: { source: 'cnn' } })
    expect(html).toContain('gtag(\'config\', \'G-TEST\', {"source":"cnn"})')
  })

  it('requires a measurement id rather than emitting a broken tag', () => {
    expect(() => analyticsBootstrap({ gaId: '' })).toThrow()
  })
})

describe('analyticsBootstrap — Worker apps', () => {
  const html = () => analyticsBootstrap({ gaId: 'G-TEST', profilePath: '/api/player' })

  it('pins client_id to the device when the profile carries one', async () => {
    const { calls, profile } = await run(html(), async () => ({
      ok: true,
      json: async () => ({ gaClientId: '123.456', deviceId: 'abc' })
    }))
    const cfg = configCalls(calls)
    expect(cfg).toHaveLength(1)
    expect(cfg[0]?.[2]).toEqual({ client_id: '123.456' })
    // Stashed so the app bundle need not re-fetch the same no-store endpoint.
    expect(profile).toEqual({ gaClientId: '123.456', deviceId: 'abc' })
  })

  it('configures WITHOUT a client_id when the screen has no device id', async () => {
    // Most screens: send_metadata is off, so there is no id and GA4's default applies.
    const { calls } = await run(html(), async () => ({
      ok: true,
      json: async () => ({ gaClientId: null })
    }))
    const cfg = configCalls(calls)
    expect(cfg).toHaveLength(1)
    expect(cfg[0]?.[2]).toEqual({})
  })

  it('still configures when the fetch rejects', async () => {
    // An offline screen must keep reporting. Telemetry is never the reason a screen goes quiet.
    const { calls } = await run(html(), async () => {
      throw new Error('offline')
    })
    expect(configCalls(calls)).toHaveLength(1)
  })

  it('still configures on a non-ok response', async () => {
    const { calls } = await run(html(), async () => ({ ok: false, json: async () => null }))
    expect(configCalls(calls)).toHaveLength(1)
  })

  it('fires gtag js before anything else, so the queue order is right', async () => {
    const { calls } = await run(html(), async () => ({
      ok: true,
      json: async () => ({ gaClientId: '1.2' })
    }))
    expect(calls[0]?.[0]).toBe('js')
  })

  it('arms a timeout so a stalled fetch cannot leave the screen silent', () => {
    // The dangerous failure is a connection that opens and never answers: no reject, no resolve.
    expect(html()).toContain('setTimeout')
    expect(html()).toContain('1500')
  })

  it('takes a custom timeout', () => {
    expect(analyticsBootstrap({ gaId: 'G-T', profilePath: '/p', timeoutMs: 400 })).toContain('400')
  })

  it('guards against configuring twice if both the timeout and the fetch land', async () => {
    // Belt and braces: the timeout is cleared on settle, but a double config would split the
    // screen across two identities, which is the exact bug this exists to prevent.
    const { calls } = await run(html(), async () => ({
      ok: true,
      json: async () => ({ gaClientId: '9.9' })
    }))
    expect(configCalls(calls)).toHaveLength(1)
    expect(html()).toContain('if (configured) return')
  })

  it('fetches the profile no-store, or a cached one would clone identities', () => {
    expect(html()).toContain("cache: 'no-store'")
  })

  it('merges app config params, with client_id winning', async () => {
    // The reader sends its feed as a config param, so the bootstrap must not drop those.
    const withParams = analyticsBootstrap({
      gaId: 'G-TEST',
      profilePath: '/api/player',
      configParams: { source: 'cnn', source_title: 'CNN' }
    })
    const { calls } = await run(withParams, async () => ({
      ok: true,
      json: async () => ({ gaClientId: '5.5' })
    }))
    expect(configCalls(calls)[0]?.[2]).toEqual({
      source: 'cnn',
      source_title: 'CNN',
      client_id: '5.5'
    })
  })

  it('cannot have client_id overridden by an app param', () => {
    const html = analyticsBootstrap({
      gaId: 'G-TEST',
      profilePath: '/api/player',
      configParams: { client_id: 'hijacked' }
    })
    // client_id is assigned after the params are spread in, so the device always wins.
    expect(html.indexOf('cfg.client_id = clientId')).toBeGreaterThan(html.indexOf('hijacked'))
  })

  it('escapes a params value that would close the script element', () => {
    const html = analyticsBootstrap({
      gaId: 'G-TEST',
      profilePath: '/api/player',
      configParams: { source: '</script><script>alert(1)</script>' }
    })
    expect(html).not.toContain('</script><script>alert(1)')
    // Both brackets, matching the per-app helpers this replaces.
    expect(html).toContain('\\u003c/script\\u003e\\u003cscript\\u003e')
  })
})

describe('analyticsBootstrap — the stall, which is the dangerous case', () => {
  const html = () => analyticsBootstrap({ gaId: 'G-TEST', profilePath: '/api/player' })

  it('configures via the timeout when the fetch never settles', async () => {
    // A host that accepts the connection and then goes quiet: no resolve, no reject. Without
    // the timeout this screen would never call config and would report nothing at all.
    const { calls, fireTimeout, readCalls } = await run(html(), () => new Promise(() => {}))
    expect(configCalls(calls)).toHaveLength(0) // nothing yet, correctly
    expect(fireTimeout).not.toBeNull()

    fireTimeout?.()

    // The property that matters: the screen DOES report, just without a pinned client_id.
    const after = configCalls(readCalls())
    expect(after).toHaveLength(1)
    expect(after[0]?.[1]).toBe('G-TEST')
    expect(after[0]?.[2]).toEqual({})
  })

  it('produces exactly one config even if the timeout fires after the profile landed', async () => {
    // Both paths racing is the scenario that would split one screen across two identities.
    const { calls, fireTimeout, cleared, readCalls } = await run(html(), async () => ({
      ok: true,
      json: async () => ({ gaClientId: '7.7' })
    }))
    expect(configCalls(calls)).toHaveLength(1)
    expect(cleared).toBe(true) // the timer was cleared on settle
    fireTimeout?.() // and firing it anyway is a no-op thanks to the guard
    expect(configCalls(readCalls())).toHaveLength(1)
  })
})

// The first page view of any client_id is sent by `config` itself, before `main.js` can run
// `trackPlayer`. Unless the player fields are set here, a screen that mints a fresh id on every
// load never attributes a single page view. Yodeck measured 150 users and 0 page views.
describe('analyticsBootstrap: attributing the first page view', () => {
  const html = () => analyticsBootstrap({ gaId: 'G-TEST', profilePath: '/api/player' })
  const setCalls = (calls: unknown[][]) =>
    calls.filter((c) => c[0] === 'set' && c[1] === 'user_properties')

  const PROPS = { player_vendor: 'yodeck', player_platform: 'firetv', player_app: 'clock' }

  it('sets the player user properties from the profile payload', async () => {
    const { calls } = await run(html(), async () => ({
      ok: true,
      json: async () => ({ gaClientId: '1.2', userProperties: PROPS })
    }))
    expect(setCalls(calls)).toHaveLength(1)
    // Forwarded verbatim: the snippet never inspects them, so the schema lives in one place.
    expect(setCalls(calls)[0]?.[2]).toEqual(PROPS)
  })

  it('sets them BEFORE config, which is the entire point', async () => {
    // After config the page_view has already gone out, and this would be a no-op that looks
    // like a fix. Ordering is the behaviour under test, not an implementation detail.
    const { calls } = await run(html(), async () => ({
      ok: true,
      json: async () => ({ gaClientId: '1.2', userProperties: PROPS })
    }))
    const setAt = calls.findIndex((c) => c[0] === 'set' && c[1] === 'user_properties')
    const configAt = calls.findIndex((c) => c[0] === 'config')
    expect(setAt).toBeGreaterThanOrEqual(0)
    expect(configAt).toBeGreaterThan(setAt)
  })

  it('configures normally when the server sent no user properties', async () => {
    // An app that has not passed `app` to playerProfileResponse yet, so the payload is the
    // old shape. It must still configure, just without attribution.
    const { calls } = await run(html(), async () => ({
      ok: true,
      json: async () => ({ gaClientId: '1.2' })
    }))
    expect(setCalls(calls)).toHaveLength(0)
    expect(configCalls(calls)).toHaveLength(1)
  })

  it('sets nothing on the timeout path, where no profile ever arrived', async () => {
    const { fireTimeout, readCalls } = await run(html(), () => new Promise(() => {}))
    fireTimeout?.()
    expect(setCalls(readCalls())).toHaveLength(0)
    expect(configCalls(readCalls())).toHaveLength(1)
  })

  it('sets them even when the screen has no device id to pin', async () => {
    // The two fixes are independent: send_metadata off still leaves a nameable player.
    const { calls } = await run(html(), async () => ({
      ok: true,
      json: async () => ({ gaClientId: null, userProperties: PROPS })
    }))
    expect(setCalls(calls)).toHaveLength(1)
    expect(configCalls(calls)[0]?.[2]).toEqual({})
  })
})
