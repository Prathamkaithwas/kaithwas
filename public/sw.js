// Cache-first shell so the app opens with no network at all.
const CACHE = 'pratham-ledger-v3'

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
          .catch(() => caches.match('/index.html')),
    ),
  )
})
