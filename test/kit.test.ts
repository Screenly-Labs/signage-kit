import { describe, expect, it } from 'bun:test'
import { rm } from 'node:fs/promises'
import { FLOOR, GATE, bundleJs, injectGate, processCss } from '../src/build.js'

describe('gate', () => {
  it('detects an old engine by the absence of replaceChildren, sets html.legacy', () => {
    expect(GATE).toContain("!('replaceChildren' in Element.prototype)")
    expect(GATE).toContain("classList.add('legacy')")
    // The over-aggressive color-mix probe must NOT be reintroduced.
    expect(GATE).not.toContain('color-mix')
  })

  it('injects before the first stylesheet link', () => {
    const out = injectGate('<head>\n    <link rel="stylesheet" href="x.css" />\n</head>')
    expect(out.indexOf('classList.add')).toBeLessThan(out.indexOf('<link rel="stylesheet"'))
  })
})

describe('floor', () => {
  it('is Chrome 87 / Safari 14.1 (where logical properties + clamp are native)', () => {
    expect(FLOOR).toContain('chrome >= 87')
    expect(FLOOR).toContain('safari >= 14.1')
  })
})

describe('processCss', () => {
  it('flattens @layer so the cascade survives on engines that drop layered rules', async () => {
    const css = '@layer a, b; @layer a { .x { color: red } } @layer b { .x { color: blue } }'
    const out = (await processCss(css, { flattenLayers: true })).toString()
    expect(out).not.toContain('@layer')
    expect(out).toContain(':not(#\\#)')
  })

  it('down-levels a single-sided logical inset to a native property at the floor', async () => {
    const out = (await processCss('.q{position:absolute;inset-inline-end:10px}')).toString()
    // At the Chrome 87 floor this stays native (no :lang()-guarded fragile lowering).
    expect(out).toContain('inset-inline-end')
    expect(out).not.toContain(':lang(')
  })

  it('prepends the shared kill-switch when includeDegraded is set', async () => {
    const out = (await processCss('.x{color:red}', { includeDegraded: true })).toString()
    expect(out).toContain('html.legacy')
    expect(out).toContain('animation:none')
  })
})

describe('bundleJs', () => {
  it('lowers modern syntax to ES2017 and emits an export-free IIFE', async () => {
    const dir = `${import.meta.dir}/.tmp`
    const entry = `${dir}/entry.js`
    const out = `${dir}/out.js`
    await Bun.write(entry, 'const x = window.foo?.bar ?? 1; document.title = String(x)')
    await bundleJs(entry, out)
    const code = await Bun.file(out).text()
    expect(code).not.toContain('?.')
    expect(code).not.toContain('??')
    expect(code).not.toContain('export ')
    await rm(dir, { recursive: true, force: true })
  })
})
