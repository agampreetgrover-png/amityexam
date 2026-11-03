import "server-only";
import { combineChunks, stringFromBase64URL } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { checkLimits } from "@/lib/ratelimit";
import { accountsConfig } from "./env";
import { callLogOf, createSupabaseServerClient } from "./server";
import { classifyAuthError } from "./session-policy";
import { proveAccessToken, refreshChecks } from "./token-proof";

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
//   3. its access token wasn't forged (token-proof.ts: checked against the project's published signing keys), and the
//      rate limits allow it: per client IP first; then, for a verified session, per session and a global cap below
//      Supabase's own per-IP /token budget (every refresh leaves from this server's IPs); for a token that can't be
//      checked here, a small budget of its own, so made-up cookies can't use up what real sessions need;
//   4. it fits inside one deadline (DEADLINE_MS) that covers the limit check and every call to Supabase, retries
//      included: after it, no further call goes out (see timedFetch). A page waits at most about that long.
//
// It refreshes with getSession(), which makes one call (POST /token) when the session is close to expiry. What
// reaches the browser is decided by the result, not by which cookies were written:
//   - no error: everything Supabase wrote, as one set: the rotated session, including deletion of chunk cookies
//     that no longer exist when the session changes size, or the removal of an unusable cookie;
//   - an error that means the session is definitely gone (session-policy.ts, the same rule route handlers use): its
//     deletions;
//   - anything else (rate limit, 408, 5xx, network, a token answer without a session) or the deadline: nothing, so
//     the student's cookies stay and a later request tries again.
// Known gap: if the deadline cuts off a refresh that Supabase had already completed, the browser keeps the old,
// now-used refresh token. Supabase's reuse interval (default 10s) only helps if the next refresh comes within it, and
// with refreshes on page loads it usually comes later. Whether Supabase then hands back the session's current token
// for that reused one, or signs the student out, is NOT yet verified: it is checked in the real dev-project run
// (S1.8). The worst case is that the student signs in again; no data is lost (it stays on this device).

export type ApplySession = (res: NextResponse) => NextResponse;
const keep: ApplySession = (res) => res;

/** Refresh this long before the access token expires (the margin Supabase's own client uses). */
export const REFRESH_MARGIN_S = 90;
/** The limit check plus every call to Supabase, together. */
export const DEADLINE_MS = 3000;
/** The rate-limit check gets at most this long. */
export const LIMIT_TIMEOUT_MS = 1000;
/** A refresh is only started with at least this much of the deadline left. */
export const MIN_REFRESH_MS = 1000;


/** The cookie Supabase's client keeps the session in: sb-<first label of the Supabase host>-auth-token. */
export const sessionCookieName = (supabaseUrl: string) => `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;

/**
 * When the session in cookie `key` expires (seconds since 1970), or null when there's no readable session with a
 * refresh token. Reads it the way @supabase/ssr writes it (chunks .0, .1…, optionally "base64-" + base64url JSON),
 * with its own helpers. This only decides whether to TRY a refresh; it is never trusted to say who anyone is.
 */
export async function sessionExpiresAt(cookies: { name: string; value: string }[], key: string): Promise<number | null> {
  const session = await readStoredSession(cookies, key);
  if (typeof session !== "object") return null;
  const { expires_at, refresh_token } = session as { expires_at?: unknown; refresh_token?: unknown };
  if (typeof refresh_token !== "string" || !refresh_token) return null; // nothing to refresh with
  return typeof expires_at === "number" && Number.isFinite(expires_at) ? expires_at : null;
}

/**
 * The stored session exactly as @supabase/ssr hands it to auth-js (same chunk and base64 handling), parsed; "none"
 * when there is no session cookie at all; "unreadable" when it is there but isn't a JSON object. Never trusted to say
 * who anyone is: it only decides whether (and within which limits) Supabase may be asked.
 */
export async function readStoredSession(cookies: { name: string; value: string }[], key: string): Promise<Record<string, unknown> | "none" | "unreadable"> {
  try {
    const raw = await combineChunks(key, (name) => cookies.find((c) => c.name === name)?.value);
    if (!raw) return "none";
    const value: unknown = JSON.parse(raw.startsWith("base64-") ? stringFromBase64URL(raw.slice("base64-".length)) : raw);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : "unreadable";
  } catch {
    return "unreadable";
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
  const started = Date.now();
  // Is the access token one this project issued (token-proof.ts)? A forged one is left alone: no budget is spent and
  // Supabase isn't asked. Only a verified one can use the main refresh budget; one that can't be checked has its own.
  const stored = await readStoredSession(cookies, key);
  const proof = await proveAccessToken(typeof stored === "object" ? stored.access_token : undefined, config, { deadline });
  if (proof.kind === "forged") return keep;
  const limit = await checkLimits(refreshChecks(proof, req.headers), LIMIT_TIMEOUT_MS);
  // Two separate reasons to stop here: the limits refused or couldn't answer in time; or they allowed it, but too
  // little of the deadline is left to start a refresh that could finish (one cut off midway can leave the browser
  // holding a refresh token Supabase has already rotated).
  if (!limit.ok) return keep;
  if (deadlineMs - (Date.now() - started) < MIN_REFRESH_MS || deadline.aborted) return keep;

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
      // "no-session" can only mean auth-js found nothing usable in the cookie and cleared it: removing it is harmless.
      else if (classifyAuthError(result.error, callLogOf(supabase)) !== "temporary") kept = [...writes];
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
