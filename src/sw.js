// Offline support. vite.config.js fills in VERSION and PRECACHE at build time.
// The app shell is cached on first visit so VideoShelf opens without internet.
const VERSION = '__VERSION__'
const PRECACHE = __PRECACHE__
const SHELL = `vidshelf-shell-${VERSION}`
const ENGINE = 'vidshelf-ffmpeg' // ffmpeg.wasm from jsDelivr, cached the first time "Make playable" runs

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['./', ...PRECACHE])).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('vidshelf-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // Page loads: always try the network so new deploys show up, fall back to the saved copy offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { if (res.ok) caches.open(SHELL).then((c) => c.put('./', res.clone())); return res })
        .catch(() => caches.match('./', { cacheName: SHELL, ignoreVary: true })),
    )
    return
  }

  // The converter engine is versioned and never changes, so serve it from cache once downloaded.
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/npm/@ffmpeg/')) {
    e.respondWith(
      caches.open(ENGINE).then(async (c) => {
        const hit = await c.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) c.put(req, res.clone())
        return res
      }),
    )
    return
  }

  // Built files have hashed names, so the cached copy is always right. ignoreVary: the server sends
  // "Vary: Origin" and module scripts are requested with an Origin header the precache requests lacked.
  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(req, { cacheName: SHELL, ignoreVary: true }).then((hit) => hit || fetch(req)))
  }
})
