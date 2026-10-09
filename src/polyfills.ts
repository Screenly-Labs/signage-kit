// Minimal runtime shim for the older-browser degraded mode, shared across every
// signage app. esbuild lowers modern *syntax* (?., ??, spread) at build time, but
// it does not add missing runtime APIs. The one DOM gap the apps can hit at the
// support floor is Element.prototype.replaceChildren (Chrome 86 / Safari 14, 2020);
// it's included as a defensive shim even in apps that don't call it directly.
//
// Imported only for its side effect (installing the shim) as the first line of a
// browser entry; it exports nothing.
//
// The ./native-dom import is load-bearing beyond the value it returns: importing it here
// is what guarantees the pre-shim reading is taken before the line below runs, whether or
// not ./capability is ever loaded.

import { HAS_NATIVE_REPLACE_CHILDREN } from './native-dom'

if (typeof Element !== 'undefined' && !HAS_NATIVE_REPLACE_CHILDREN) {
  Element.prototype.replaceChildren = function replaceChildren(
    this: Element,
    ...nodes: (Node | string)[]
  ): void {
    // Build the new children in a fragment first so a bad node throws before we
    // touch the element, keeping the swap effectively atomic like the native API.
    const frag = document.createDocumentFragment()
    frag.append(...nodes)
    while (this.firstChild) this.removeChild(this.firstChild)
    this.appendChild(frag)
  }
}
