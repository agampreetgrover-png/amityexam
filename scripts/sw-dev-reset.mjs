// Runs before `npm run dev`. A production build leaves its service worker in public/sw.js; in dev that
// stale worker keeps serving the old build's cached pages, so code changes never show up.
// Replace it with a worker that clears those caches, unregisters itself and reloads open tabs.
import { readdirSync, rmSync, writeFileSync } from "node:fs";

for (const f of readdirSync("public")) if (/^swe-worker-.*\.js$/.test(f) || f === "sw.js.map") rmSync(`public/${f}`);

writeFileSync(
  "public/sw.js",
  `// Development only: removes a service worker left over from a production build.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url);
  })());
});
`,
);
