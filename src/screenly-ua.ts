// The Screenly-player UA token set, kept in its own leaf module (no imports) so that
// ./branding can run the lightweight isScreenlyPlayer() check without pulling in the full
// ./profiler classifier (its regex tables and package map). Both ./branding and ./profiler
// import this, so there is still a single source of truth for the token set.

/**
 * Screenly player UA tokens — the original `screenly-viewer` check, enriched to also match
 * `ScreenlyWebview` and (via the shared `-viewer` token) `screenly-viewer/2.0`.
 * Case-sensitive on purpose: these are the exact tokens Screenly devices emit.
 */
export const SCREENLY_UA = /screenly-viewer|ScreenlyWebview/
