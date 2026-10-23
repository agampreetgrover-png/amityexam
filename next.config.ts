import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

// New revision per build so precached app pages refresh after every deploy.
const revision = randomUUID();
// /subjects/view and /exams/view take the id as ?id=, so these two entries cover every subject and exam offline.
const PAGES = ["/", "/subjects", "/subjects/view", "/exams", "/exams/view", "/progress", "/settings", "/~offline"];
// Listing entries by hand replaces Serwist's default public/ glob, so the pdf.js worker (copied there by
// postinstall) must be added too, or PDFs can't be read offline. Hashed so it only re-downloads when pdf.js changes.
const PDF_WORKER = "/pdf.worker.min.mjs";
const pdfWorkerRevision = createHash("sha256").update(readFileSync(`public${PDF_WORKER}`)).digest("hex").slice(0, 16);

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  cacheOnNavigation: true,
  reloadOnOnline: false, // don't wipe in-progress quiz answers when the connection returns
  additionalPrecacheEntries: [...PAGES.map((url) => ({ url, revision })), { url: PDF_WORKER, revision: pdfWorkerRevision }],
  disable: process.env.NODE_ENV === "development",
});

// A full script CSP would need per-request nonces for Next's inline scripts, which breaks
// static pages and offline precaching, so only the directives that can't break the app are set.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
];

const nextConfig: NextConfig = {
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
