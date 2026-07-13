// Shared "is this a Screenly player?" check and the promotional-badge remover,
// used by every signage app. On a Screenly player the viewer is already a
// Screenly customer, so the promotional badge is removed; every other browser
// keeps it. The 'screenly-viewer' token in the user agent marks these devices.
//
// This replaces the ~14 byte-identical copies of removeScreenlyBranding() that
// were pasted into each app's browser entry. Imported into main.ts and bundled
// by the app (esbuild lowers the modern syntax), exactly like ./polyfills.

/** True when running on a Screenly player (its UA carries `screenly-viewer`). */
export const isScreenlyPlayer = (): boolean =>
  typeof navigator !== 'undefined' && navigator.userAgent.includes('screenly-viewer')

/**
 * Remove the promotional Screenly badge on Screenly players. No-op elsewhere.
 * Pass a selector if the app's badge is not the default `.brand`.
 */
export const removeScreenlyBranding = (selector = '.brand'): void => {
  if (isScreenlyPlayer() && typeof document !== 'undefined') {
    document.querySelector(selector)?.remove()
  }
}
