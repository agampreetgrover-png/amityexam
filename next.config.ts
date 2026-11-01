import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
import { securityHeaders } from "./src/lib/security-headers";

// New revision per build so precached app pages refresh after every deploy.
const revision = randomUUID();
// /subjects/view and /exams/view take the id as ?id=, so these two entries cover every subject and exam offline.
const PAGES = ["/", "/subjects", "/subjects/view", "/important", "/zero-prep", "/chat", "/exams", "/exams/view", "/settings", "/~offline"];
// Listing entries by hand replaces Serwist's default public/ glob, so the pdf.js worker (copied there by
// postinstall) must be added too, or PDFs can't be read offline. Hashed so it only re-downloads when pdf.js changes.
const PDF_WORKER = "/pdf.worker.min.mjs";
const pdfWorkerRevision = createHash("sha256").update(readFileSync(`public${PDF_WORKER}`)).digest("hex").slice(0, 16);

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // Off: Serwist's "cache on navigation" patches history.pushState/replaceState and has a separate worker fetch each
  // visited URL (query string included) straight into the "pages" cache, bypassing the service worker's routes and
  // so the never-cache rules (src/lib/sw-rules.ts). Every app page is in PAGES below, precached for offline use,
  // so it added nothing for offline use and could have cached sign-in pages or one-time sign-in links.
  cacheOnNavigation: false,
  reloadOnOnline: false, // don't wipe in-progress quiz answers when the connection returns
  additionalPrecacheEntries: [...PAGES.map((url) => ({ url, revision })), { url: PDF_WORKER, revision: pdfWorkerRevision }],
  disable: process.env.NODE_ENV === "development",
  // KaTeX's CSS lists each font as woff2, woff and ttf, and webpack emits all three. Browsers only fetch the woff2,
  // so the other ~0.8 MB isn't precached. The first two are Serwist's defaults, which this list replaces.
  exclude: [/\.map$/, /^manifest.*\.js$/, /\.(?:woff|ttf)$/i],
});


const nextConfig: NextConfig = {
  poweredByHeader: false,
  // `npm run dev` only: with the list set (even empty), Next blocks other sites from reaching its /_next and
  // /__nextjs dev endpoints (one of them restarts the server) instead of just warning. Its own host still works.
  // It checks Origin, not Host, so a DNS-rebinding page can still reach them: keep dev for working on the code.
  allowedDevOrigins: [],
  // No next/image is used. Off, the optimizer can't be pointed at the app's own /api routes.
  images: { unoptimized: true },
  experimental: {
    // Middleware runs on /api, and Next cuts request bodies it buffers for middleware at 10 MB by default.
    // /api/ai/extract takes up to 21 MB (a 15 MB scan as base64), which would otherwise arrive truncated.
    middlewareClientMaxBodySize: "22mb",
  },
  // Drive sync parses PDFs on the server; pdf.js must load its worker from node_modules, not a bundle.
  serverExternalPackages: ["pdfjs-dist", "mammoth", "jszip"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Subject and exam pages used to be /subjects/<id> and /exams/<id>; keep old links and bookmarks working.
  // The service worker does the same redirect offline (src/app/sw.ts).
  async redirects() {
    return [
      { source: "/subjects/:id(\\d+)", destination: "/subjects/view?id=:id", permanent: false },
      { source: "/exams/:id(\\d+)", destination: "/exams/view?id=:id", permanent: false },
    ];
  },
};

export default withSerwist(nextConfig);
