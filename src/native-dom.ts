// What the DOM looked like before this package touched it.
//
// A leaf module with NO imports, so it is evaluated before the body of anything that
// imports it. Both ./polyfills and ./capability import it, and ES module instances are
// cached, so whichever of the two is reached first takes the reading — and both are
// reached before ./polyfills gets as far as installing a shim.
//
// This exists because the two are in direct conflict. ./polyfills installs
// `Element.prototype.replaceChildren`, and ./capability uses the presence of that exact
// property to decide whether an engine is stale: it is the gate's own staleness check (see
// ./gate.js). Every app imports the polyfill as the first line of its browser entry, by
// design, so by the time `trackPlayer` probes, the property is always there and the engine
// always looks modern. Reading the live prototype at probe time cannot answer the question
// any more; this snapshot can.

/**
 * Whether `Element.prototype.replaceChildren` was the engine's own, as opposed to the one
 * ./polyfills installs. `false` where there is no DOM at all (SSR, a Worker, a test runner),
 * which is why callers must check for a live `Element` before trusting it — "there was no
 * DOM to read" and "the DOM lacked the API" are different answers.
 *
 * Tested with `in` rather than truthiness, matching the gate, so a key present but holding
 * `undefined` reads as present in both places.
 */
export const HAS_NATIVE_REPLACE_CHILDREN =
  typeof Element !== 'undefined' && 'replaceChildren' in Element.prototype
