import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

/**
 * The service worker is for the browser only.
 *
 * Inside the Android app it is worse than useless: the assets already ship in
 * the APK, so it caches nothing that was not already local, and it serves
 * index.html cache-first. After installing a new APK that cached index.html
 * would still be handed to the WebView, pointing at the previous build's
 * asset filenames — which are also still cached. The app would keep running
 * the old version and no amount of reinstalling would visibly change
 * anything.
 *
 * So: never register it natively, and actively tear down any worker left
 * behind by an earlier build that did.
 */
if ('serviceWorker' in navigator) {
  if (Capacitor.isNativePlatform()) {
    void navigator.serviceWorker
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .then(() => caches?.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))))
      .catch(() => {
        /* nothing registered, or caches unavailable — either is fine */
      })
  } else if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* offline caching is best-effort */
      })
    })
  }
}
