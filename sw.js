/* Service worker — makes the app open instantly and work offline.
   Strategy: "stale-while-revalidate" for the app's own files:
   show the saved copy immediately, download the newest copy in the
   background for next time. Google Sheets calls are never cached here.
   After uploading big changes you can bump VERSION to clear old copies. */
const VERSION = 'ssdc-v1';
const CORE = [
    "./",
    "index.html",
    "css/app.css",
    "manifest.webmanifest",
    "assets/logo-256.webp",
    "assets/icon-192.png",
    "js/00-boot.js",
    "js/01-core.js",
    "js/02-treatment-payment.js",
    "js/03-receipt-numbers.js",
    "js/04-combined-bill.js",
    "js/05-patients-appointments.js",
    "js/06-exam-form.js",
    "js/07-whatsapp.js",
    "js/08-mobile-sidebar.js",
    "js/09-bt-printer.js",
    "js/vendor/qrcode.min.js",
    "js/10-bt-print-qr.js",
    "js/11-wa-templates.js",
    "js/99-speed.js"
  ];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Sheets, QR images etc. go straight to network

  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const key = req.mode === 'navigate' ? './index.html' : req;
      const cached = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached);
      if (cached) { e.waitUntil(network); return cached; }
      return network;
    })
  );
});
