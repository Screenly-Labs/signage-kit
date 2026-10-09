// The one environment test/capability.test.ts cannot construct: the real globals, with the
// real ./polyfills shim installed over them.
//
// That file hands `detectCapability` a synthetic window, which is the right way to test the
// probes themselves but leaves the module's single largest hazard uncovered. ./polyfills
// installs `Element.prototype.replaceChildren`; ./capability used the presence of that exact
// property to decide whether an engine is stale; and every app imports the polyfill as the
// first line of its browser entry. So in a browser the property was always there by probe
// time, `old` could never fire, and `reason` could only ever be `none`, `slow` or
// `probe-failed` — while every synthetic test went on passing.
//
// This file therefore runs the real thing in order: old-engine globals, then the real
// polyfill, then the real probe. It lives apart from capability.test.ts because it mutates
// globals and depends on module evaluation order, and both need to happen before anything
// else in the file has imported ./capability.

import { describe, expect, it } from 'bun:test'

/** An engine without `replaceChildren` — pre-Chromium-86, the gate's own staleness check. */
class OldElement {}

// Before any import of ./polyfills or ./capability, so ./native-dom's snapshot is taken
// against this and not against the test runner's bare environment.
;(globalThis as { Element?: unknown }).Element = OldElement
;(globalThis as { document?: unknown }).document = {
  createDocumentFragment: () => ({ append() {} })
}

/** The live window as an app sees it: old engine, healthy hardware, no modern CSS. */
const liveWindow = {
  Element: OldElement as unknown as { prototype: object },
  navigator: { deviceMemory: 8, hardwareConcurrency: 8 },
  CSS: { supports: () => false }
}

describe('detectCapability — with ./polyfills installed, as every app loads it', () => {
  it('still reports an old engine as old', async () => {
    await import('../src/polyfills')
    // The shim really did land: without it this assertion is testing nothing.
    expect('replaceChildren' in OldElement.prototype).toBe(true)

    const { detectCapability } = await import('../src/capability')
    const cap = detectCapability(liveWindow)

    // The regression. Before the ./native-dom snapshot these were `false` and `'none'`:
    // the probe reported a screen the gate had already put on the degraded path as healthy.
    expect(cap.degraded).toBe(true)
    expect(cap.reason).toBe('old')
  })

  it('separates old from slow on the same live globals', async () => {
    const { detectCapability } = await import('../src/capability')
    expect(detectCapability({ ...liveWindow, navigator: { deviceMemory: 1 } }).reason).toBe(
      'old+slow'
    )
  })

  it('still probes a caller-supplied stub on its own terms', async () => {
    const { detectCapability } = await import('../src/capability')
    // A stub carrying its own `Element` is not the object the shim patched, so it must be
    // read directly — this is the Worker and unit-test path, and the snapshot must not leak
    // into it.
    const modern = {
      Element: { prototype: { replaceChildren: () => {} } },
      navigator: { deviceMemory: 8, hardwareConcurrency: 8 },
      CSS: { supports: () => true },
      CSSLayerBlockRule: class {}
    }
    expect(detectCapability(modern).reason).toBe('none')
  })
})
