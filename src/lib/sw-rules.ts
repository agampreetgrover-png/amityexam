// What the service worker's routes must never put in a cache (src/app/sw.ts), kept here so it can be tested.
// Everything listed can carry someone's identity or data; a cache keyed by URL would hand it to whoever uses this
// browser next. App pages stay cacheable: they are the same for every visitor and read their data from IndexedDB.
// This rule only covers requests that go through the service worker. Serwist's cacheOnNavigation fetched pages
// from a separate worker, around these routes, so it is switched off in next.config.ts (and check:build fails if
// it comes back).

/** Sign-in pages (Phase 2b). Listed now so they are never cached from the first day they exist. */
export const AUTH_PAGES = ["/login", "/signup", "/check-email", "/forgot-password", "/reset-password", "/switch"];

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

export function neverCache({ url, sameOrigin }: { url: URL; sameOrigin: boolean }): boolean {
  // Every other site: Supabase, Turnstile, AI providers. Serwist's default would keep them for an hour by URL.
  if (!sameOrigin) return true;
  const p = url.pathname;
  return p.startsWith("/api/") || under(p, "/auth") || AUTH_PAGES.some((page) => under(p, page));
}
