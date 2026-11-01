import "server-only";
import { isAuthSessionMissingError } from "@supabase/supabase-js";

// One rule, used everywhere a Supabase Auth error has to be judged (the middleware's refresh, verifyUser in route
// handlers): is the session DEFINITELY gone, so the student is signed out and its cookies may be removed, or is it
// unknown for now (rate limit, timeout, outage, an answer we can't read), so nothing changes and a later request
// tries again? Anything not listed as definitive is treated as temporary: being wrong that way leaves a student
// signed in a little longer; being wrong the other way would sign them out for nothing.

/** One answer Supabase Auth gave a client, recorded by timedFetch (server.ts). */
export interface AuthCall {
  endpoint: "token" | "user";
  /** HTTP status; 0 when no answer arrived (network error, aborted, past the deadline). */
  status: number;
  /** Supabase's error code, when the answer was an error that carried one. */
  code?: string;
}
/**
 * Every /token and /user answer one client got, in order. A client lives for one request, so this is that request's
 * whole record, and it is never cleared: Supabase's client starts refreshing an expired session the moment it is
 * created, before anything asks it to, and the answer to that refresh is evidence that must not be lost.
 */
export interface AuthCallLog {
  calls: AuthCall[];
}
/** Keeps the log small: auth-js retries a failing refresh a handful of times at most. */
export const MAX_LOGGED_CALLS = 20;

/** Supabase error codes that mean the session can never be used again. */
export const DEFINITIVE_CODES: ReadonlySet<string> = new Set([
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_expired",
  "session_not_found",
  "user_not_found",
  "user_banned",
  "bad_jwt",
]);

export type Verdict =
  /** Supabase said the session is gone for good. */
  | "definitive"
  /** No session was there to begin with: this client never asked Supabase anything. */
  | "no-session"
  /** Unknown for now: try again later, change nothing. */
  | "temporary";

export function classifyAuthError(error: unknown, log?: AuthCallLog): Verdict {
  // auth-js reports several different things as AuthSessionMissingError: Supabase answering session_not_found (a
  // revoked session: definitive); having had no session at all (nothing to ask about); and a session it removed itself
  // after a refresh it couldn't use (e.g. /token answering 200 {} or failing), including when it answers from its own
  // cache of a recent failure without asking again. Only this client's record of answers tells them apart:
  //   - Supabase said session_not_found at any point → definitive;
  //   - this client never got an answer about a session (no calls) → there was none to begin with;
  //   - it did ask, and no answer said the session is gone → unknown, so temporary.
  if (isAuthSessionMissingError(error)) {
    const calls = log?.calls ?? [];
    if (calls.some((c) => c.code === "session_not_found")) return "definitive";
    return calls.length === 0 ? "no-session" : "temporary";
  }
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && DEFINITIVE_CODES.has(code) ? "definitive" : "temporary";
}
