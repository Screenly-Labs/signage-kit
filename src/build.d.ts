/** Shared support floor (browserslist queries) for the whole fleet. */
export declare const FLOOR: string[]
/** Inline degraded-mode gate as an HTML string. */
export declare const GATE: string
/** Insert the gate before the first stylesheet <link> in an HTML string. */
export declare function injectGate(html: string): string
/** Down-level + minify CSS to the floor. */
export declare function processCss(
  cssText: string,
  opts?: { flattenLayers?: boolean; includeDegraded?: boolean; filename?: string }
): Promise<Uint8Array>
/** Bundle a browser entry to a self-contained script at the floor's syntax level. */
export declare function bundleJs(
  entry: string,
  outfile: string,
  opts?: { format?: 'iife' | 'esm' }
): Promise<void>
