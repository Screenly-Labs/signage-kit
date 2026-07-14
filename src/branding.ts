// Shared "is this a Screenly player?" check and the promotional-badge remover,
// used by every signage app. On a Screenly player the viewer is already a
// Screenly customer, so the promotional badge is removed; every other browser
// keeps it. Screenly players are marked by a token in the user agent.
//
// This replaces the ~14 byte-identical copies of removeScreenlyBranding() that
// were pasted into each app's browser entry. Imported into main.ts and bundled
// by the app (esbuild lowers the modern syntax), exactly like ./polyfills.

import { detectPlayer } from './profiler'

/**
 * True when running on a Screenly player. Delegates to the shared profiler, which
 * enriches the original `screenly-viewer` UA check to also recognise the
 * `ScreenlyWebview` and versioned `screenly-viewer/2.0` variants.
 */
export const isScreenlyPlayer = (): boolean => detectPlayer().vendor === 'screenly'

/**
 * Remove the promotional Screenly badge on Screenly players. No-op elsewhere.
 * Pass a selector if the app's badge is not the default `.brand`.
 */
export const removeScreenlyBranding = (selector = '.brand'): void => {
  if (isScreenlyPlayer() && typeof document !== 'undefined') {
    document.querySelector(selector)?.remove()
  }
}
