/**
 * public/onlyoffice/document_editor_service_worker.js
 *
 * ONLYOFFICE's editor registers a service worker during boot (see the editor's
 * index.html). CryptPad's offline build does NOT ship one, so the registration
 * 404s — and the editor's init awaits `navigator.serviceWorker.ready`, which
 * then never resolves, hanging the whole app before it loads the document.
 *
 * This is a minimal no-op SW: it registers + activates cleanly so `ready`
 * resolves. We deliberately do NOT intercept fetches — the editor's assets are
 * already same-origin under the locked-down CSP, and an offline cache is
 * unnecessary (and undesirable) for the E2EE embed.
 */
self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

// No "fetch" handler → the browser uses default (network) behaviour, governed
// by the page CSP. Nothing is cached.
