import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Old /subjects/<id> and /exams/<id> URLs (bookmarks, older links). The server redirects them too, but offline only
// this worker can, sending them on to the precached /subjects/view?id=<id> page.
const OLD_DETAIL_URL = /^\/(subjects|exams)\/(\d+)\/?$/;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: {
    // /subjects/view?id=2&tab=quiz is served by the precached /subjects/view; the page reads them itself.
    // (The first two are Serwist's defaults, which this list replaces.)
    ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^id$/, /^tab$/],
  },
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ request, url, sameOrigin }) => sameOrigin && request.mode === "navigate" && OLD_DETAIL_URL.test(url.pathname),
      handler: async ({ url }) => {
        const [, section, id] = url.pathname.match(OLD_DETAIL_URL)!;
        const to = new URL(`/${section}/view${url.search}`, url.origin);
        to.searchParams.set("id", id);
        return Response.redirect(to.href, 302);
      },
    },
    ...defaultCache,
  ],
  fallbacks: {
    entries: [{ url: "/~offline", matcher: ({ request }) => request.destination === "document" }],
  },
});

serwist.addEventListeners();

// Tapping a notification focuses the app (or opens it).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients[0];
      return open ? open.focus() : self.clients.openWindow("/");
    }),
  );
});
