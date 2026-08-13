/** Shared support floor (browserslist queries) for the whole fleet. */
export declare const FLOOR: string[]
/** Inline degraded-mode gate as an HTML string. */
export declare const GATE: string
/** Insert the gate before the first stylesheet <link> in an HTML string. */
export declare function injectGate(html: string): string
/** The font URL prefix baked into styles/fonts.css. */
export declare const FONT_URL_PREFIX: string
/**
 * Down-level + minify CSS to the floor.
 *
 * `fontPath` rewrites styles/fonts.css's `/static/fonts/` prefix, for consumers
 * that are not served from the document root. Pair it with the `destDir` given to
 * `syncFonts()`.
 */
export declare function processCss(
  cssText: string,
  opts?: {
    flattenLayers?: boolean
    includeDegraded?: boolean
    filename?: string
    fontPath?: string
  }
): Promise<Uint8Array>
/** Bundle a browser entry to a self-contained script at the floor's syntax level. */
export declare function bundleJs(
  entry: string,
  outfile: string,
  opts?: { format?: 'iife' | 'esm' }
): Promise<void>
