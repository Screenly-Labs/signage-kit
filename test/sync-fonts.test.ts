import { describe, expect, it, afterAll } from 'bun:test'
import { readFileSync, existsSync, rmSync } from 'node:fs'
import { FONTS, syncFonts } from '../src/sync-fonts.js'

const fontsCss = readFileSync(new URL('../styles/fonts.css', import.meta.url), 'utf8')

describe('FONTS manifest', () => {
  it('every entry has a @fontsource package and at least one woff2 file', () => {
    for (const [key, spec] of Object.entries(FONTS)) {
      expect(spec.pkg, key).toMatch(/^@fontsource(-variable)?\//)
      expect(spec.files.length, key).toBeGreaterThan(0)
      for (const f of spec.files) expect(f, key).toMatch(/\.woff2$/)
    }
  })

  it('is the single source of truth: every manifest file is declared in fonts.css', () => {
    for (const spec of Object.values(FONTS)) {
      for (const f of spec.files) {
        expect(fontsCss, f).toContain(`/static/fonts/${f}`)
      }
    }
  })

  it('every woff2 referenced by fonts.css is backed by the manifest (no orphans)', () => {
    const declared = new Set(Object.values(FONTS).flatMap((s) => s.files))
    const referenced = [...fontsCss.matchAll(/\/static\/fonts\/([\w-]+\.woff2)/g)]
      .map((m) => m[1])
      .filter((f): f is string => Boolean(f))
    expect(referenced.length).toBeGreaterThan(0)
    for (const f of referenced) expect(declared.has(f), f).toBe(true)
  })
})

describe('syncFonts', () => {
  const dest = new URL('./.tmp-fonts', import.meta.url).pathname
  afterAll(() => rmSync(dest, { recursive: true, force: true }))

  it('resolves the @fontsource deps and vendors the requested woff2', async () => {
    const n = await syncFonts(['fraunces', 'hanken-grotesk'], dest)
    expect(n).toBe(3)
    expect(existsSync(`${dest}/fraunces-latin-standard-normal.woff2`)).toBe(true)
    expect(existsSync(`${dest}/fraunces-latin-standard-italic.woff2`)).toBe(true)
    expect(existsSync(`${dest}/hanken-grotesk-latin-wght-normal.woff2`)).toBe(true)
  })
})
