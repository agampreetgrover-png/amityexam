import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountsConfig } from "./env";

// The only way this app talks to Supabase: from the server, per request. The browser never gets a Supabase client,
// so it never needs to read the session cookies, and every one of them is HttpOnly. Every cookie Supabase writes
// (the session, its .0/.1 chunks, the PKCE code verifier, and their deletions) goes through secureCookieOptions.

/** Where a request's cookies are read from and written to (middleware request/response, or a route handler). */
export interface CookieJar {
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options: CookieOptions): void;
  /** The cache headers Supabase hands over with the first cookie write: the response must not be cached. */
  setHeaders?(headers: Record<string, string>): void;
}

/**
 * Supabase's own options (expiry, deletion via maxAge 0) are kept; the security flags are not negotiable.
 * Secure needs HTTPS: Vercel always is; a laptop copy on http://127.0.0.1 is not, and browsers drop Secure cookies there.
 */
export function secureCookieOptions(options: CookieOptions, https: boolean): CookieOptions {
  return { ...options, httpOnly: true, sameSite: "lax", path: "/", secure: https };
}

/** What a call made after the deadline gets instead of a request: a 408, which Supabase's client treats as final. */
const pastDeadline = () =>
  new Response(JSON.stringify({ code: "request_timeout", msg: "Deadline passed; not sent." }), { status: 408, headers: { "Content-Type": "application/json" } });

/**
 * fetch with time limits: each call gives up after `ms`, and all calls end at `deadline` (one signal shared by the
 * whole operation). Supabase's client retries failed calls with backoff for up to ~30s; after the deadline those
 * retries are answered here with a 408 without going out, so its retry loop ends instead of reaching Supabase again.
 */
export const timedFetch =
  (ms: number, deadline?: AbortSignal): typeof fetch =>
  (input, init) => {
    if (deadline?.aborted) return Promise.resolve(pastDeadline());
    const signals = [AbortSignal.timeout(ms), deadline, init?.signal].filter((s): s is AbortSignal => !!s);
    return fetch(input, { ...init, signal: AbortSignal.any(signals) });
  };

/**
 * A fresh client for one request, or null when accounts are off. Never reuse one across requests. Every call it
 * makes to Supabase times out after `timeoutMs`, and none is made after `deadline` (the middleware's, which sits in
 * front of every page).
 */
export function createSupabaseServerClient(
  jar: CookieJar,
  { https, timeoutMs = 8000, deadline }: { https: boolean; timeoutMs?: number; deadline?: AbortSignal },
): SupabaseClient | null {
  const config = accountsConfig();
  if (!config.enabled) return null;
  return createServerClient(config.url, config.publishableKey, {
    global: { fetch: timedFetch(timeoutMs, deadline) },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (cookies, headers) => {
        for (const { name, value, options } of cookies) jar.set(name, value, secureCookieOptions(options, https));
        if (Object.keys(headers).length) jar.setHeaders?.(headers);
      },
    },
  });
}