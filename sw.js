// NOCTURNE service worker: makes the app shell available offline.
// Update-safe: same-origin requests go to the network first (so a deploy is
// picked up on the next load and files never mix versions), falling back to
// the cache only when offline or the network stalls. Bump VERSION when the
// shell file list changes; old caches are deleted on activate.
// Network requests bypass the browser HTTP cache (cache: "no-cache" revalidates
// with the server), because GitHub Pages sends max-age=600: without this a
// "network-first" fetch could still hand back a 10-minute-old app.js.
const VERSION = "v9-2026.11.21-p5";
const CACHE = `nocturne-shell-${VERSION}`;
const SHELL = [
  "./", // not "./index.html": hosts with clean URLs (Vercel) redirect it
  "./app.js",
  "./app.js?v=2026.11.21-p5",
  "./fonts/fonts.css?v=2026.11.21-p5",
  "./manifest.webmanifest",
  "./src/audio.mjs",
  "./src/music.mjs",
  "./src/state-io.mjs",
  "./src/wav.mjs",
  "./src/export.mjs",
  "./src/beat-ai.mjs",
  "./src/sequencer.mjs",
  "./src/samples.mjs",
  "./src/midi.mjs",
  "./src/classics.mjs",
  "./src/loopers.mjs",
  "./src/synths.mjs",
  "./src/chords.mjs",
  "./src/patterns.mjs",
  "./fonts/fonts.css",
  "./fonts/jetbrains-mono-latin.woff2",
  "./fonts/space-grotesk-latin.woff2",
  "./fonts/saira-xc-600-latin.woff2",
  "./fonts/saira-xc-800-latin.woff2",
  "./icons/icon-48.png",
  "./icons/icon-72.png",
  "./icons/icon-96.png",
  "./icons/icon-128.png",
  "./icons/icon-144.png",
  "./icons/icon-152.png",
  "./icons/icon-192.png",
  "./icons/icon-256.png",
  "./icons/icon-384.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./icons/favicon-16.png",
  "./favicon.ico",
];
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("nocturne-shell-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // AI API etc. go straight to the network
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // Navigations can't be re-wrapped with an init, so refetch them by URL.
      const fresh = req.mode === "navigate" ? fetch(req.url, { cache: "no-cache", credentials: "same-origin" }) : fetch(req, { cache: "no-cache" });
      const res = await Promise.race([fresh, timeout(NETWORK_TIMEOUT_MS)]);
      if (res && res.ok && res.type === "basic") cache.put(req, res.clone());
      return res;
    } catch {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === "navigate") {
        const shell = await cache.match("./");
        if (shell) return shell;
      }
      return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
    }
  })());
});
