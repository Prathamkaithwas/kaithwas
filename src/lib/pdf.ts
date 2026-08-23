/**
 * Rasterises a stored PDF (a data URL) into a plain image, so a document
 * saved as a PDF can be shown the same way a photo is — inline, scrollable,
 * no "can't preview this" placeholder.
 *
 * `pdfjs-dist` is never in the main bundle: every export here dynamic-imports
 * it on first use. A shop that never scans a PDF should not pay for a PDF
 * renderer on every cold start, especially after last session's work getting
 * the bundle back down. The render itself is real work too (decode + lay out
 * + rasterise a page), so results are cached by data URL — opening the same
 * document's viewer twice, or a thumbnail re-rendering after a state change,
 * reuses the first render instead of redoing it.
 */

import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let configured = false
async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist')
  if (!configured) {
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    configured = true
  }
  return pdfjs
}

/** data URL -> rendered page-1 PNG data URL. Small (a handful of documents
 *  open per session), never persisted — this is a render cache, not storage. */
const renderCache = new Map<string, Promise<string>>()

/**
 * Renders a PDF's first page to a PNG data URL.
 *
 * Page 1 only, matching how this app already treats a PDF entry as "one
 * page" everywhere else (the thumbnail grid, the page-count badge on a
 * multi-file document) — a multi-page PDF scanned in as a single document
 * page is rarer than a multi-page *document* built from several single-page
 * files, which the picker already supports directly.
 */
export function renderPdfPage(dataUrl: string, maxWidth = 1000): Promise<string> {
  const cached = renderCache.get(dataUrl)
  if (cached) return cached

  const promise = (async () => {
    const pdfjs = await loadPdfjs()
    const doc = await pdfjs.getDocument({ url: dataUrl }).promise
    try {
      const page = await doc.getPage(1)
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(2, maxWidth / base.width)
      const viewport = page.getViewport({ scale })

      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no 2d context')

      await page.render({ canvasContext: ctx, viewport, canvas }).promise
      return canvas.toDataURL('image/png')
    } finally {
      // cleanup(), not destroy() — destroy() lives on the loading task
      // returned by getDocument(), before it resolves to this proxy. This
      // frees the document's cached resources without invalidating the
      // proxy itself, which is all that's needed once the one page this
      // function cares about has been rendered.
      await doc.cleanup()
    }
  })()

  // A failed render (a corrupt file, a format pdf.js can't parse) must not
  // wedge the cache — the next attempt should get a fresh try, not the same
  // rejected promise forever.
  promise.catch(() => renderCache.delete(dataUrl))
  renderCache.set(dataUrl, promise)
  return promise
}
