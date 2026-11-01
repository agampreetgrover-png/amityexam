import "server-only";
import { combineChunks, stringFromBase64URL } from "@supabase/ssr";
import { isAuthSessionMissingError } from "@supabase/supabase-js";
import type { NextRequest, NextResponse } from "next/server";
import { checkLimits, clientIp } from "@/lib/ratelimit";
import { accountsConfig } from "./env";
import { createSupabaseServerClient } from "./server";

// Keeps a signed-in session fresh when a page is loaded. It decides nothing about who is signed in: that is getUser()
// in the route handlers (src/lib/auth.ts), which also refresh a session themselves when this one didn't.
//
// Supabase is contacted only when all of these hold, so this middleware, which sits in front of every page, can't be
// used to make this server send requests to Supabase:
//   1. accounts are on, and the request is a page load (not a prefetch, data or API request: one refresh per page
//      load instead of several at once from the same browser);
//   2. it carries THIS project's session cookie (sb-<ref>-auth-token), which reads as a session with a refresh token
//      whose access token expires within REFRESH_MARGIN_S (a made-up or garbled cookie, or a session that's still
//      fresh, sends nothing at all);
//   3. the rate limits allow it: per client IP first, then a global cap below Supabase's own per-IP /token budget
//      (every refresh leaves from this server's IPs);
//   4. it fits inside one deadline (DEADLINE_MS) that covers the limit check and every call to Supabase, retries
//      included: after it, no further call goes out (see timedFetch). A page waits at most about that long.
//
// It refreshes with getSession(), which makes one call (POST /token) when the session is close to expiry. What
// reaches the browser is decided by the result, not by which cookies were written:
//   - no error: everything Supabase wrote, as one set: the rotated session, including deletion of chunk cookies
//     that no longer exist when the session changes size, or the removal of an unusable cookie;
//   - an error that means the session is definitely gone: its deletions;
//   - any other error (rate limit, 408, 5xx, network) or the deadline: nothing, so the student's cookies stay and a
//     later request tries again.
// If the deadline cuts off a refresh that Supabase completed, the browser keeps the old refresh token; Supabase's
// refresh-token reuse interval (keep it at its default of 10s or more) lets the next request use it once more.

export type ApplySession = (res: NextResponse) => NextResponse;
const keep: ApplySession = (res) => res;

/** Refresh this long before the access token expires (the margin Supabase's own client uses). */
export const REFRESH_MARGIN_S = 90;
/** The limit check plus every call to Supabase, together. */
export const DEADLINE_MS = 3000;
const LIMIT_TIMEOUT_MS = 1000;

/** Supabase answers that mean the session is gone for good, so its cookies should go too. */
const DEFINITIVE_CODES = new Set(["refresh_token_not_found", "refresh_token_already_used", "session_expired", "user_not_found", "user_banned"]);
// A revoked session (Supabase's "session_not_found") reaches us as AuthSessionMissingError, which has no code.
const isDefinitive = (error: unknown) => isAuthSessionMissingError(error) || DEFINITIVE_CODES.has((error as { code?: string })?.code ?? "");

/** The cookie Supabase's client keeps the session in: sb-<first label of the Supabase host>-auth-token. */
export const sessionCookieName = (supabaseUrl: string) => `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;

/**
 * When the session in cookie `key` expires (seconds since 1970), or null when there's no readable session with a
 * refresh token. Reads it the way @supabase/ssr writes it (chunks .0, .1…, optionally "base64-" + base64url JSON),
 * with its own helpers. This only decides whether to TRY a refresh; it is never trusted to say who anyone is.
 */
export async function sessionExpiresAt(cookies: { name: string; value: string }[], key: string): Promise<number | null> {
  try {
    const raw = await combineChunks(key, (name) => cookies.find((c) => c.name === name)?.value);
    if (!raw) return null;
    const json = raw.startsWith("base64-") ? stringFromBase64URL(raw.slice("base64-".length)) : raw;
    const session: unknown = JSON.parse(json);
    if (!session || typeof session !== "object") return null;
    const { expires_at, refresh_token } = session as { expires_at?: unknown; refresh_token?: unknown };
    if (typeof refresh_token !== "string" || !refresh_token) return null; // nothing to refresh with
    return typeof expires_at === "number" && Number.isFinite(expires_at) ? expires_at : null;
  } catch {
    return null;
  }
}

const isHttps = (req: NextRequest) => req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
/** A browser loading a page (the same test the middleware uses for the unlock page). */
const isPageLoad = (req: NextRequest) =>
  req.headers.get("sec-fetch-mode") === "navigate" || (req.method === "GET" && !!req.headers.get("accept")?.includes("text/html"));

type CookieWrite = { name: string; value: string; options: Parameters<NextResponse["cookies"]["set"]>[2] };

/**
 * Refresh the session if it needs it and the conditions above allow. Kept cookies are written to the request (so
 * this request's route handlers see them) and returned as a function that copies them, with Supabase's no-cache
 * headers, onto whatever response the middleware ends up sending.
 */
export async function refreshSession(req: NextRequest, { now = Date.now, deadlineMs = DEADLINE_MS }: { now?: () => number; deadlineMs?: number } = {}): Promise<ApplySession> {
  const config = accountsConfig();
  if (!config.enabled || !isPageLoad(req)) return keep;
  const cookies = req.cookies.getAll();
  const key = sessionCookieName(config.url);
  if (!cookies.some((c) => c.name === key || c.name.startsWith(`${key}.`))) return keep;

  const expiresAt = await sessionExpiresAt(cookies, key);
  if (expiresAt === null || expiresAt - now() / 1000 > REFRESH_MARGIN_S) return keep;

  // One deadline for everything from here on, shared by every call Supabase's client makes (retries included).
  const deadline = AbortSignal.timeout(deadlineMs);
  const limit = await checkLimits(
    [
      { bucket: "session:ip", key: clientIp(req.headers) },
      { bucket: "session:global", key: "all" },
    ],
    Math.min(LIMIT_TIMEOUT_MS, deadlineMs),
  );
  if (!limit.ok || deadline.aborted) return keep;

  const writes: CookieWrite[] = [];
  let headers: Record<string, string> = {};
  const supabase = createSupabaseServerClient(
    {
      getAll: () => req.cookies.getAll(),
      set: (name, value, options) => writes.push({ name, value, options }),
      setHeaders: (h) => (headers = { ...headers, ...h }),
    },
    { https: isHttps(req), timeoutMs: deadlineMs, deadline },
  );
  if (!supabase) return keep;

  const timedOut = new Promise<"timeout">((resolve) => deadline.addEventListener("abort", () => resolve("timeout"), { once: true }));
  let kept: CookieWrite[] = [];
  try {
    const result = await Promise.race([supabase.auth.getSession(), timedOut]);
    if (result !== "timeout") {
      if (!result.error) kept = [...writes];
      else if (isDefinitive(result.error)) kept = [...writes];
    }
  } catch (e) {
    console.error("[accounts] session refresh failed:", e instanceof Error ? e.message : "unknown");
  }
  if (!kept.length) return keep;

  for (const w of kept) req.cookies.set(w.name, w.value);
  return (res) => {
    for (const w of kept) res.cookies.set(w.name, w.value, w.options);
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    return res;
  };
}
