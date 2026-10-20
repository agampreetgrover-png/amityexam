import { randomUUID } from "node:crypto";
import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

// New revision per build so precached app pages refresh after every deploy.
const revision = randomUUID();
const PAGES = ["/", "/planner", "/subjects", "/exams", "/revise", "/progress", "/settings", "/~offline"];

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  cacheOnNavigation: true,
  reloadOnOnline: false, // don't wipe in-progress quiz answers when the connection returns
  additionalPrecacheEntries: PAGES.map((url) => ({ url, revision })),
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
};

export default withSerwist(nextConfig);
