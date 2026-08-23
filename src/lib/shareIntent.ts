/**
 * Files shared into this app from Android's own Share sheet — "Share" on a
 * photo or PDF in another app, then pick Kaithwas from the list.
 *
 * MainActivity.java owns the actual Android side (the SEND/SEND_MULTIPLE
 * intent-filters in AndroidManifest.xml, and reading the shared file off a
 * content:// URI, which the web layer has no API for at all). It hands the
 * result over as raw base64 + mime + a suggested filename — deliberately not
 * as a finished stored data URL, so the existing size/downscale rules in
 * lib/photo.ts run on it exactly as they would on a normally picked file,
 * rather than this file quietly reimplementing them a second time.
 *
 * Same window-bridge pattern as lib/insets.ts's LedgerBars: a
 * @JavascriptInterface object attached to the WebView, read as a global.
 * Elsewhere — a browser, iOS — the bridge is simply absent and every
 * function here reports nothing pending, the same as Android with no
 * shared file waiting.
 */

import { App as CapApp } from '@capacitor/app'

interface LedgerShare {
  consumePendingShare?: () => string | null
}

function bridge(): LedgerShare | undefined {
  return (window as unknown as { LedgerShare?: LedgerShare }).LedgerShare
}

interface RawSharedFile {
  name: string
  mime: string
  base64: string
}

function base64ToBlob(base64: string, mime: string): Blob {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/**
 * One poll of the native side. Called more than once after startup (see
 * watchSharedFiles below) because the native read happens on a background
 * thread — the file may genuinely not be ready on the very first ask, which
 * is different from there being nothing shared at all.
 */
function consumeOnce(): File[] {
  const raw = bridge()?.consumePendingShare?.()
  if (!raw) return []
  let parsed: RawSharedFile[]
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.map((p) => new File([base64ToBlob(p.base64, p.mime)], p.name, { type: p.mime }))
}

const POLL_DELAYS = [0, 400, 900, 1600, 3000]

/**
 * One burst of polling — five tries over three seconds, generous for how
 * long reading and base64-encoding even a large camera photo actually
 * takes. The common case (no share at all) exits on the very first empty
 * check rather than waiting out the whole window.
 */
function pollBurst(onFiles: (files: File[]) => void, isCancelled: () => boolean): void {
  let attempt = 0
  const tick = () => {
    if (isCancelled()) return
    const files = consumeOnce()
    if (files.length) {
      onFiles(files)
      return
    }
    attempt++
    if (attempt < POLL_DELAYS.length) {
      window.setTimeout(tick, POLL_DELAYS[attempt])
    }
  }
  tick()
}

/**
 * Watches for a shared file, both at launch and for as long as the app
 * stays open.
 *
 * A single poll burst at mount only ever catches a *cold* start — the app
 * wasn't running, so this component's first render is also the moment
 * MainActivity.onCreate() first read the share. But Android rarely fully
 * kills Kaithwas between opens; picking it from another app's Share sheet
 * usually finds it still alive in the background and hands the file to
 * MainActivity.onNewIntent() instead, with no new mount of this component to
 * start a fresh burst. The one-shot version left that file queued on the
 * native side forever — correctly read, never picked up — because by the
 * time it arrived, the only poll window this ran was already minutes in the
 * past. Re-running the same burst on every return to the foreground is what
 * actually catches that case: coming back from the Share sheet always fires
 * `appStateChange` with `isActive: true`, right as whatever was just shared
 * is landing in the native queue.
 */
export function watchSharedFiles(onFiles: (files: File[]) => void): () => void {
  let cancelled = false
  const isCancelled = () => cancelled

  pollBurst(onFiles, isCancelled)
  const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) pollBurst(onFiles, isCancelled)
  })

  return () => {
    cancelled = true
    void sub.then((s) => s.remove())
  }
}
