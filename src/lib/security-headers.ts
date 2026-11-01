// Headers sent with every response (next.config.ts). Kept here so tests can check them.
// A full script CSP would need per-request nonces for Next's inline scripts, which breaks
// static pages and offline precaching, so only the directives that can't break the app are set.
export const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
  // img-src: AI answers are Markdown, and an injected remote image would leak data to another site.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; img-src 'self' data: blob:" },
  // Ignored over plain http (127.0.0.1); keeps a deployed copy on https.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];
