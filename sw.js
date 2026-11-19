// NOCTURNE service worker: makes the app shell available offline.
// Update-safe: same-origin requests go to the network first (so a deploy is
// picked up on the next load and files never mix versions), falling back to
// the cache only when offline or the network stalls. Bump VERSION when the
// shell file list changes; old caches are deleted on activate.
const VERSION = "v4";
const CACHE = `nocturne-shell-${VERSION}`;
const SHELL = [
  "./", // not "./index.html": hosts with clean URLs (Vercel) redirect it
  "./app.js",
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
  "./fonts/fonts.css",
  "./fonts/jetbrains-mono-latin.woff2",
  "./fonts/space-grotesk-latin.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
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
      const res = await Promise.race([fetch(req), timeout(NETWORK_TIMEOUT_MS)]);
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
