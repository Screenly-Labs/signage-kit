/** One family in the canonical webfont set. */
export interface FontSpec {
  /** @fontsource package that ships the woff2 files (a kit dependency). */
  pkg: string
  /** woff2 filenames under `<pkg>/files/`. */
  files: string[]
}

/** Canonical family key -> package/version/files. Single source of truth. */
export declare const FONTS: Record<string, FontSpec>

/**
 * Vendor the woff2 for the given families into destDir (default
 * `assets/static/fonts`). Resolves files from the app's own node_modules.
 * Returns the number of files vendored.
 */
export declare function syncFonts(families: string[], destDir?: string): Promise<number>
