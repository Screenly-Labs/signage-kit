// The inline degraded-mode gate as a plain string, with NO build-tool imports, so
// it's safe to import from a Cloudflare Worker SSR template (Layout.tsx) as well as
// from the build (index.html injection). Runs in <head> before the stylesheet:
// flags the device html.legacy when the engine is old (no Element.replaceChildren,
// a 2020-era API) or the hardware looks weak, then the stylesheet drops animation.
export const GATE = `<!-- Degraded mode for older/weaker signage players (@screenly-labs/signage-kit). -->
    <script>
      (function () {
        try {
          var slow =
            (navigator.deviceMemory && navigator.deviceMemory <= 2) ||
            (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2)
          var old = !('replaceChildren' in Element.prototype)
          if (slow || old) document.documentElement.classList.add('legacy')
        } catch (e) {
          document.documentElement.classList.add('legacy')
        }
      })()
    </script>`
