// Cache-first shell so the app opens with no network at all.
const CACHE = 'pratham-ledger-v4'

// The app now uses the system font, so the four Comfortaa faces this used to
// precache are gone. addAll() rejects as a unit if any single entry 404s,
// which would have left the worker permanently uninstalled — so each asset is
// cached independently and a miss costs only that one file.
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg']

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.all(SHELL.map((url) => c.add(url).catch(() => undefined)))),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return
  // The offline fallback is a page to show, not a stand-in for any failed
  // request. It used to catch every GET indiscriminately — an image whose
  // fetch failed (an uncached background photo before it had ever loaded
  // once, on a real device, for whatever WebView-specific reason) was
  // silently handed the HTML shell in its place, which renders as a
  // present-but-blank/broken image rather than an obvious network error.
  // Scoped to navigations only now, so a failed asset fetch fails visibly
  // instead of quietly wearing the wrong response.
  const isNavigation = e.request.mode === 'navigate'
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request)
          .then((res) => {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(e.request, copy))
            return res
          })
          .catch(() => (isNavigation ? caches.match('/index.html') : Promise.reject())),
    ),
  )
})
