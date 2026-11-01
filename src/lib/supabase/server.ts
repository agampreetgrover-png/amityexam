import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accountsConfig } from "./env";
import { MAX_LOGGED_CALLS, type AuthCall, type AuthCallLog } from "./session-policy";

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

/** Which Supabase Auth call a URL is, for the call log (the two whose answers decide sign-out). */
const authEndpoint = (url: string): AuthCall["endpoint"] | null =>
  url.includes("/auth/v1/token") ? "token" : url.includes("/auth/v1/user") ? "user" : null;

/** Supabase's error code from an error answer, without consuming the body auth-js is about to read. */
async function errorCode(res: Response): Promise<string | undefined> {
  if (res.ok) return undefined;
  try {
    const body: unknown = await res.clone().json();
    const b = body as { code?: unknown; error_code?: unknown } | null;
    return typeof b?.code === "string" ? b.code : typeof b?.error_code === "string" ? b.error_code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * fetch with time limits: each call gives up after `ms`, and all calls end at `deadline` (one signal shared by the
 * whole operation). Supabase's client retries failed calls with backoff for up to ~30s; after the deadline those
 * retries are answered here with a 408 without going out, so its retry loop ends instead of reaching Supabase again.
 * With a `log`, every /token or /user answer (status and error code) is recorded for session-policy.ts.
 */
export const timedFetch =
  (ms: number, deadline?: AbortSignal, log?: AuthCallLog): typeof fetch =>
  async (input, init) => {
    const endpoint = log ? authEndpoint(String(input instanceof Request ? input.url : input)) : null;
    if (deadline?.aborted) {
      if (endpoint) record(log!, { endpoint, status: 0 });
      return pastDeadline();
    }
    const signals = [AbortSignal.timeout(ms), deadline, init?.signal].filter((s): s is AbortSignal => !!s);
    let res: Response;
    try {
      res = await fetch(input, { ...init, signal: AbortSignal.any(signals) });
    } catch (e) {
      if (endpoint) record(log!, { endpoint, status: 0 });
      throw e;
    }
    if (endpoint) record(log!, { endpoint, status: res.status, code: await errorCode(res) });
    return res;
  };

/** Appends an answer to a client's log (never cleared; see AuthCallLog), keeping it bounded. */
function record(log: AuthCallLog, call: AuthCall) {
  log.calls.push(call);
  if (log.calls.length > MAX_LOGGED_CALLS) log.calls.splice(0, log.calls.length - MAX_LOGGED_CALLS);
}

/** The call log of a client made here (undefined for any other client). One client, and so one log, per request. */
const logs = new WeakMap<SupabaseClient, AuthCallLog>();
export const callLogOf = (client: SupabaseClient): AuthCallLog | undefined => logs.get(client);

type ClientOptions = { https: boolean; timeoutMs?: number; deadline?: AbortSignal };

/**
 * A client for one request against a given project. createSupabaseServerClient uses it with the configured project;
 * tests use it directly. Every cookie goes through secureCookieOptions, and every call through timedFetch with a log.
 */
export function buildServerClient(url: string, publishableKey: string, jar: CookieJar, { https, timeoutMs = 8000, deadline }: ClientOptions): SupabaseClient {
  const log: AuthCallLog = { calls: [] };
  const client = createServerClient(url, publishableKey, {
    global: { fetch: timedFetch(timeoutMs, deadline, log) },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (cookies, headers) => {
        for (const { name, value, options } of cookies) jar.set(name, value, secureCookieOptions(options, https));
        if (Object.keys(headers).length) jar.setHeaders?.(headers);
      },
    },
  });
  logs.set(client, log);
  return client;
}

/**
 * A fresh client for one request, or null when accounts are off. Never reuse one across requests. Every call it
 * makes to Supabase times out after `timeoutMs`, and none is made after `deadline` (the middleware's, which sits in
 * front of every page).
 */
export function createSupabaseServerClient(jar: CookieJar, options: ClientOptions): SupabaseClient | null {
  const config = accountsConfig();
  if (!config.enabled) return null;
  return buildServerClient(config.url, config.publishableKey, jar, options);
}