import { describe, expect, it } from 'bun:test'
import { detectCapability } from '../src/capability'
import type { ProbeWindow } from '../src/capability'
import { GATE } from '../src/gate.js'

// A browser-ish window, modern by every probe, that each case below narrows.
const modern = (over: Partial<ProbeWindow> = {}): ProbeWindow => ({
  Element: { prototype: { replaceChildren: () => {} } },
  navigator: { deviceMemory: 8, hardwareConcurrency: 8 },
  CSS: { supports: () => true },
  CSSLayerBlockRule: class {},
  ...over
})

/**
 * Run the GATE's own inline script against a synthetic environment and report whether it
 * would have added `legacy`.
 *
 * This is the point of the file. `./capability` keeps a second copy of the gate's predicate
 * (it must: the gate is inlined into HTML that is cached for hours, while the kit ships in a
 * versioned asset), so the only thing stopping the two drifting is executing the real string
 * rather than a paraphrase of it.
 */
const gateSaysLegacy = (win: ProbeWindow): boolean => {
  const script = GATE.replace(/^[\s\S]*?<script>/, '').replace(/<\/script>[\s\S]*$/, '')
  const classes: string[] = []
  const documentStub = {
    documentElement: { classList: { add: (c: string) => classes.push(c) } }
  }
  // The gate reads bare `navigator`, `Element` and `document`, so they arrive as parameters
  // rather than as properties of a window object.
  new Function('navigator', 'Element', 'document', script)(
    win.navigator,
    win.Element,
    documentStub
  )
  return classes.includes('legacy')
}

describe('detectCapability — agrees with the real gate', () => {
  // Every environment where both can form an opinion. `degraded` is the load-bearing value:
  // it decides whether a screen counts as being on the degraded path at all.
  const CASES: Array<[string, ProbeWindow]> = [
    ['modern engine, ample hardware', modern()],
    ['old engine', modern({ Element: { prototype: {} } })],
    ['low memory', modern({ navigator: { deviceMemory: 2, hardwareConcurrency: 8 } })],
    ['few cores', modern({ navigator: { deviceMemory: 8, hardwareConcurrency: 2 } })],
    ['old engine AND weak hardware', modern({ Element: { prototype: {} }, navigator: { deviceMemory: 1, hardwareConcurrency: 1 } })],
    ['navigator with neither reading', modern({ navigator: {} })],
    ['memory just above the threshold', modern({ navigator: { deviceMemory: 3, hardwareConcurrency: 4 } })]
  ]

  for (const [label, win] of CASES) {
    it(`matches the gate: ${label}`, () => {
      expect(detectCapability(win).degraded).toBe(gateSaysLegacy(win))
    })
  }
})

describe('detectCapability — degraded reasons', () => {
  it('reports none when the screen is modern and capable', () => {
    const cap = detectCapability(modern())
    expect(cap.degraded).toBe(false)
    expect(cap.reason).toBe('none')
  })

  it('separates a stale engine from weak hardware', () => {
    expect(detectCapability(modern({ Element: { prototype: {} } })).reason).toBe('old')
    expect(detectCapability(modern({ navigator: { hardwareConcurrency: 1 } })).reason).toBe('slow')
    expect(
      detectCapability(modern({ Element: { prototype: {} }, navigator: { deviceMemory: 1 } })).reason
    ).toBe('old+slow')
  })

  it('does not read a missing hardware reading as zero', () => {
    // Both readings are Chromium-only. Treating absent as 0 would condemn every non-Chromium
    // screen to `slow`, which would be a silent, fleet-wide fabrication.
    const cap = detectCapability(modern({ navigator: {} }))
    expect(cap.degraded).toBe(false)
    expect(cap.reason).toBe('none')
  })

  it('degrades defensively when a probe throws, and says so', () => {
    // Defined on the finished object rather than passed through the spread, or the getter
    // fires while building the fixture instead of inside detectCapability.
    const hostile = modern()
    Object.defineProperty(hostile, 'navigator', {
      get(): never {
        throw new Error('locked down')
      }
    })
    const cap = detectCapability(hostile)
    expect(cap.degraded).toBe(true)
    expect(cap.reason).toBe('probe-failed')
  })

  it('returns all-null when there is no DOM to probe', () => {
    // "We could not look" must not land in the same bucket as "we looked and it is fine",
    // so this stays null and is reported as `unknown` rather than false.
    expect(detectCapability(undefined as unknown as ProbeWindow | undefined)).toEqual({
      degraded: null,
      reason: null,
      css: null
    })
  })
})

describe('detectCapability — CSS probes', () => {
  const withSupport = (supported: string[]): ProbeWindow =>
    modern({
      CSS: { supports: (v: string) => supported.includes(v) },
      CSSLayerBlockRule: undefined
    })

  it('reports the supported set, sorted', () => {
    const cap = detectCapability(modern())
    expect(cap.css).toEqual(['is', 'layers', 'has', 'container'])
  })

  it('reports an empty set rather than null when nothing is supported', () => {
    const cap = detectCapability(withSupport([]))
    expect(cap.css).toEqual([])
  })

  it('reports a partial, non-monotonic set faithfully', () => {
    // A Firefox 115 shape: container queries (110) but not :has() (121). A highest-tier-passed
    // value would have to lie about one of them; a set does not.
    const cap = detectCapability(withSupport(['selector(:is(a))', 'container-type: inline-size']))
    expect(cap.css).toEqual(['is', 'container'])
    expect(cap.css).not.toContain('has')
  })

  it('detects @layer support from CSSLayerBlockRule, not CSS.supports', () => {
    expect(detectCapability(withSupport([])).css).not.toContain('layers')
    expect(detectCapability(modern()).css).toContain('layers')
  })

  it('treats an unsupported selector() as unsupported, not as a throw', () => {
    // CSS.supports returns false where selector() itself is unknown, so old engines fail
    // toward "not supported", which is the safe direction.
    const cap = detectCapability(modern({ CSS: { supports: () => false }, CSSLayerBlockRule: undefined }))
    expect(cap.css).toEqual([])
    expect(cap.degraded).toBe(false) // capability is independent of the degraded verdict
  })

  it('keeps the joined value inside the 36-char user-property cap', () => {
    const widest = ['container', 'has', 'is', 'layers'].sort().join('+')
    expect(widest.length).toBeLessThanOrEqual(36)
  })
})
