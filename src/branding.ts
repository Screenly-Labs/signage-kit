// Shared "is this a Screenly player?" check and the promotional-badge remover,
// used by every signage app. On a Screenly player the viewer is already a
// Screenly customer, so the promotional badge is removed; every other browser
// keeps it. Screenly players are marked by a token in the user agent.
//
// This replaces the ~14 byte-identical copies of removeScreenlyBranding() that
// were pasted into each app's browser entry. Imported into main.ts and bundled
// by the app (esbuild lowers the modern syntax), exactly like ./polyfills.

import { SCREENLY_UA } from './screenly-ua'

/**
 * True when running on a Screenly player. Uses the shared `SCREENLY_UA` token set (one
 * cheap regex — no full profile, no referrer parse) from the tiny `./screenly-ua` leaf
 * module, so the badge path never pulls in the full profiler. Enriches the original
 * `screenly-viewer` check to also recognise `ScreenlyWebview` and `screenly-viewer/2.0`.
 */
export const isScreenlyPlayer = (): boolean =>
  typeof navigator !== 'undefined' &&
  typeof navigator.userAgent === 'string' &&
  SCREENLY_UA.test(navigator.userAgent)

/**
 * Remove the promotional Screenly badge on Screenly players. No-op elsewhere.
 * Pass a selector if the app's badge is not the default `.brand`.
 */
export const removeScreenlyBranding = (selector = '.brand'): void => {
  if (isScreenlyPlayer() && typeof document !== 'undefined') {
    document.querySelector(selector)?.remove()
  }
}
