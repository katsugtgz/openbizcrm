/**
 * Minimal PWA service worker: cache-first for same-origin static assets,
 * network-first for navigations with the offline page as fallback.
 * Version the cache name to invalidate old entries on deploy.
 */
const CACHE = "openbizcrm-v2";
const OFFLINE_URL = "/offline.html";

const PRECACHE = [OFFLINE_URL, "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        // Tolerate individual failures so one missing asset cannot block
        // installation entirely; the runtime cache covers the gap.
        const results = await Promise.allSettled(
          PRECACHE.map((url) => cache.add(url)),
        );
        for (const result of results) {
          if (result.status === "rejected") {
            console.warn("[sw] precache failed:", result.reason);
          }
        }
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (
    request.method !== "GET" ||
    new URL(request.url).origin !== self.location.origin
  )
    return;

  if (request.mode === "navigate") {
    // Network-first: fresh pages, offline fallback when the network fails.
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(request).then((hit) => hit ?? caches.match(OFFLINE_URL)),
      ),
    );
    return;
  }

  // Cache-first for immutable _next/static assets; network-first for the rest.
  if (new URL(request.url).pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              // Detached write → tie to the fetch event lifecycle so the
              // asset is guaranteed cached after its first fetch.
              event.waitUntil(
                caches.open(CACHE).then((cache) => cache.put(request, copy)),
              );
            }
            return response;
          }),
      ),
    );
  }
});
