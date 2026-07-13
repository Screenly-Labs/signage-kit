#!/usr/bin/env bun
/* global Bun */
// Shared webfont vendoring for Screenly-Labs signage apps. Copies the
// self-hosted woff2 files out of the @fontsource packages and into the app's
// font dir (served at /static/fonts/). No CDN at runtime — every app ships the
// exact files it serves.
//
// The @fontsource packages are DEPENDENCIES of this kit (added via `bun add`),
// so bun + the lockfile own the versions in one place and every app gets the
// same files transitively — no per-app @fontsource deps, no version drift, and
// nothing pinned by hand here. The FONTS manifest below just maps a family key
// to its package + files; syncFonts() resolves them from wherever bun placed
// them (hoisted to the app root, or nested under this package).
//
// This replaces the ~15 drifted per-app sync-fonts.{js,ts} scripts. Apps call
// syncFonts() from their build with the family keys they use.

/**
 * @typedef {Object} FontSpec
 * @property {string} pkg    @fontsource package that ships the woff2 files
 * @property {string[]} files  woff2 filenames under `<pkg>/files/`
 */

/** @type {Record<string, FontSpec>} */
export const FONTS = {
  fraunces: {
    pkg: '@fontsource-variable/fraunces',
    files: ['fraunces-latin-standard-normal.woff2', 'fraunces-latin-standard-italic.woff2']
  },
  'hanken-grotesk': {
    pkg: '@fontsource-variable/hanken-grotesk',
    files: ['hanken-grotesk-latin-wght-normal.woff2']
  },
  'bricolage-grotesque': {
    pkg: '@fontsource-variable/bricolage-grotesque',
    files: ['bricolage-grotesque-latin-standard-normal.woff2']
  },
  newsreader: {
    pkg: '@fontsource-variable/newsreader',
    files: ['newsreader-latin-standard-normal.woff2', 'newsreader-latin-standard-italic.woff2']
  },
  'space-mono': {
    pkg: '@fontsource/space-mono',
    files: ['space-mono-latin-400-normal.woff2', 'space-mono-latin-700-normal.woff2']
  },
  'jetbrains-mono': {
    pkg: '@fontsource-variable/jetbrains-mono',
    files: ['jetbrains-mono-latin-wght-normal.woff2']
  }
}

// Resolve a woff2 from this package's vantage point so it's found whether bun
// hoisted @fontsource to the app root or nested it under the kit. Falls back to
// the plain cwd-relative node_modules path.
const resolveFont = (pkg, file) => {
  const rel = `${pkg}/files/${file}`
  try {
    return Bun.resolveSync(rel, import.meta.dir)
  } catch {
    return `node_modules/${rel}`
  }
}

/**
 * Vendor the woff2 for the given families into destDir.
 * @param {string[]} families  keys of FONTS to vendor (e.g. ['fraunces','hanken-grotesk'])
 * @param {string} [destDir='assets/static/fonts']  where to write the files
 * @returns {Promise<number>} count of files vendored
 */
export const syncFonts = async (families, destDir = 'assets/static/fonts') => {
  let count = 0

  for (const family of families) {
    const spec = FONTS[family]
    if (!spec) {
      console.error(`✗ Unknown font "${family}" — known: ${Object.keys(FONTS).join(', ')}`)
      process.exit(1)
    }

    for (const file of spec.files) {
      const src = Bun.file(resolveFont(spec.pkg, file))
      if (!(await src.exists())) {
        console.error(`✗ Missing ${file} (${spec.pkg}) — run \`bun install\` first.`)
        process.exit(1)
      }
      await Bun.write(`${destDir}/${file}`, src)
      console.log(`✓ Font: ${destDir}/${file}`)
      count++
    }
  }

  console.log(`Fonts synced — ${count} file(s) vendored from @fontsource.`)
  return count
}
