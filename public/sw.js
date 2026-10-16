/* TFUEL: logo cache — first visit stores the logos; later visits load them from cache instantly */
const C = "tfuel-img-v1";
const LOGOS = ["/logo.png", "/usdt.png", "https://iili.io/nMRQttV.png", "https://iili.io/nMRQttV.th.png", "https://iili.io/nAWDxcX.png"];
self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(C).then((c) => Promise.all(LOGOS.map((u) => fetch(u, { mode: u.startsWith("/") ? "same-origin" : "no-cors" }).then((r) => (r.ok || r.type === "opaque" ? c.put(u, r) : null)).catch(() => {})))));
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.method !== "GET" || r.destination !== "image" || !LOGOS.some((l) => r.url === l || r.url.endsWith(l))) return;
  e.respondWith(caches.match(r, { ignoreVary: true }).then((hit) => hit || fetch(r).then((res) => { if (res.ok || res.type === "opaque") { const cp = res.clone(); caches.open(C).then((c) => c.put(r, cp)); } return res; })));
});
