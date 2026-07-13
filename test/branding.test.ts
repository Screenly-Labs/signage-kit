import { describe, expect, it, afterEach } from 'bun:test'
import { isScreenlyPlayer, removeScreenlyBranding } from '../src/branding'

// branding.ts reads the `navigator` and `document` globals. Bun has no DOM, so
// stub them per-test and restore after.
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')

const setUA = (ua: string): void => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: ua },
    configurable: true,
    writable: true
  })
}

afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
  else Reflect.deleteProperty(globalThis, 'navigator')
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
  else Reflect.deleteProperty(globalThis, 'document')
})

describe('isScreenlyPlayer', () => {
  it('is true when the UA carries the screenly-viewer token', () => {
    setUA('Mozilla/5.0 screenly-viewer/2.0 Chrome/120')
    expect(isScreenlyPlayer()).toBe(true)
  })

  it('is false for an ordinary browser UA', () => {
    setUA('Mozilla/5.0 (X11; Linux) Chrome/120 Safari/537.36')
    expect(isScreenlyPlayer()).toBe(false)
  })
})

describe('removeScreenlyBranding', () => {
  const makeDocument = () => {
    let removed = 0
    let queried: string | null = null
    Object.defineProperty(globalThis, 'document', {
      value: {
        querySelector(sel: string) {
          queried = sel
          return {
            remove: () => {
              removed++
            }
          }
        }
      },
      configurable: true,
      writable: true
    })
    return {
      get removed() {
        return removed
      },
      get queried() {
        return queried
      }
    }
  }

  it('removes the default .brand badge on a Screenly player', () => {
    setUA('screenly-viewer')
    const doc = makeDocument()
    removeScreenlyBranding()
    expect(doc.queried).toBe('.brand')
    expect(doc.removed).toBe(1)
  })

  it('honours a custom selector', () => {
    setUA('screenly-viewer')
    const doc = makeDocument()
    removeScreenlyBranding('.rail__brand')
    expect(doc.queried).toBe('.rail__brand')
    expect(doc.removed).toBe(1)
  })

  it('is a no-op (never queries the DOM) on a normal browser', () => {
    setUA('Chrome/120')
    const doc = makeDocument()
    removeScreenlyBranding()
    expect(doc.queried).toBeNull()
    expect(doc.removed).toBe(0)
  })

  it('does not throw when there is no document (e.g. off the main thread)', () => {
    setUA('screenly-viewer')
    Reflect.deleteProperty(globalThis, 'document')
    expect(() => removeScreenlyBranding()).not.toThrow()
  })
})
