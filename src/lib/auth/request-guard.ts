import "server-only";

// Every state-changing /auth/* request (sign-in, sign-up, sign-out, password changes…) must come from this app's own
// pages, as JSON. Enforced twice, on purpose:
//   1. by the middleware, for every non-GET /auth/* request, before the password gate, the session refresh or any
//      handler runs (src/middleware.ts);
//   2. by each /auth/* route handler itself (authRequestRefusal), so a handler stays protected even if the
//      middleware's matcher, order or path handling ever changes.
//
// Stricter than the /api check in the middleware: a state-changing auth request must PROVE it is same-origin. Every
// browser that can run this app sends Origin on a POST and Sec-Fetch-Site on every fetch, so a request that carries
// neither is not one of our pages and is refused. Where both are present they must agree.
// Requiring application/json closes the "simple request" route too: an HTML form or a no-cors fetch from another site
// can only send text/plain, form-urlencoded or multipart bodies, never JSON, without a CORS preflight we never answer.
// Responses use the client's error shape ({ error: { code } }, src/lib/auth/client.ts) and are never cached.

const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/** The browser's statement that `headers` came from a page on `host` (the request's Host header). */
export function isSameOrigin(headers: Headers, host: string): boolean {
  const site = headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false; // cross-site, same-site (a sibling subdomain) or none
  const origin = headers.get("origin");
  if (origin === null) return site === "same-origin";
  if (!host) return false;
  try {
    const o = new URL(origin); // "null" (sandboxed frames, file:, some redirects) throws here and is refused
    if (o.protocol !== "https:" && o.protocol !== "http:") return false;
    // Host normalised the same way as Origin (case, the scheme's default port), so "a.app" equals "A.APP:443" on https.
    return o.host === new URL(`${o.protocol}//${host}`).host;
  } catch {
    return false;
  }
}

/** application/json, with or without parameters (charset). Not +json variants, not a look-alike. */
export function isJsonContentType(value: string | null): boolean {
  return !!value && value.split(";")[0].trim().toLowerCase() === "application/json";
}

/** An /auth/* error answer in the client's shape, never cached. */
export const authError = (status: number, code: string): Response =>
  Response.json({ error: { code } }, { status, headers: { "Cache-Control": "no-store" } });

/** Whether a path is one of the /auth/* endpoints (not /authors, not /auth-something). */
export const isAuthPath = (pathname: string): boolean => pathname === "/auth" || pathname.startsWith("/auth/");

/**
 * The refusal for a request that may not reach an /auth/* handler, or null when it may. GET and HEAD pass (they must
 * change nothing); every other method must be same-origin (403 blocked) and carry JSON (415 invalid_input).
 */
export function authRequestRefusal(req: Request): Response | null {
  const method = req.method.toUpperCase();
  if (SAFE_METHODS.has(method)) return null;
  if (!isSameOrigin(req.headers, req.headers.get("host") ?? "")) return authError(403, "blocked");
  if (!isJsonContentType(req.headers.get("content-type"))) return authError(415, "invalid_input");
  return null;
}
