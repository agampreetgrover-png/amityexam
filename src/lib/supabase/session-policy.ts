import "server-only";
import { isAuthSessionMissingError } from "@supabase/supabase-js";

// One rule, used everywhere a Supabase Auth error has to be judged (the middleware's refresh, verifyUser in route
// handlers): is the session DEFINITELY gone, so the student is signed out and its cookies may be removed, or is it
// unknown for now (rate limit, timeout, outage, an answer we can't read), so nothing changes and a later request
// tries again? Anything not listed as definitive is treated as temporary: being wrong that way leaves a student
// signed in a little longer; being wrong the other way would sign them out for nothing.

/** One answer Supabase Auth gave a client, recorded by timedFetch (server.ts). */
export interface AuthCall {
  /**
   * "refresh": /token?grant_type=refresh_token, about the session the client already holds.
   * "user": /user, about the session the client already holds.
   * "sign-in": any other /token grant, /verify or /signup: these can START a session, and say nothing about the old one.
   */
  endpoint: "refresh" | "user" | "sign-in";
  /** HTTP status; 0 when no answer arrived (network error, aborted, past the deadline). */
  status: number;
  /** Supabase's error code, when the answer was an error that carried one. */
  code?: string;
  /** Set on a sign-in answer that carried a new session: from here on, only later answers are about that session. */
  session?: true;
}
/**
 * Every refresh, /user and sign-in answer one client got, in order. A client lives for one request, so this is that
 * request's whole record, and it is never cleared: Supabase's client starts refreshing an expired session the moment
 * it is created, before anything asks it to, and the answer to that refresh is evidence that must not be lost.
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
  /** No session was there to begin with: this client never asked Supabase anything about one. */
  | "no-session"
  /** Unknown for now: try again later, change nothing. */
  | "temporary";

/**
 * The answers that can speak about the session this client holds NOW: refresh and /user answers, and only those after
 * the last sign-in that started a new session. A sign-in answer itself is never evidence (a refused password says
 * nothing about a session), and answers about a stale session the client inherited from the cookies no longer count
 * once a new session has replaced it (R2).
 */
export function sessionEvidence(log?: AuthCallLog): AuthCall[] {
  const calls = log?.calls ?? [];
  let from = 0;
  for (let i = 0; i < calls.length; i++) if (calls[i].endpoint === "sign-in" && calls[i].session) from = i + 1;
  return calls.slice(from).filter((c) => c.endpoint === "refresh" || c.endpoint === "user");
}

/**
 * The code that proves the session is gone, or null when nothing does: the error's own code when it is definitive;
 * for a missing session, the first definitive code in this client's evidence (sessionEvidence). The second case is how
 * the refresh auth-js starts by itself reaches a later check: after ANY definitive refresh answer
 * (refresh_token_not_found, refresh_token_already_used, session_expired, user_banned…) auth-js removes the session,
 * and from then on reports only "Auth session missing!", without a code. Only answers timedFetch recorded for THIS
 * client count.
 */
export function definitiveCode(error: unknown, log?: AuthCallLog): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && DEFINITIVE_CODES.has(code)) return code;
  if (!isAuthSessionMissingError(error)) return null;
  return sessionEvidence(log).find((c) => c.code !== undefined && DEFINITIVE_CODES.has(c.code))?.code ?? null;
}

export function classifyAuthError(error: unknown, log?: AuthCallLog): Verdict {
  // auth-js reports several different things as AuthSessionMissingError: Supabase answering session_not_found (a
  // revoked session); a session it removed itself after a refresh answer saying the session is gone; having had no
  // session at all (nothing to ask about); and a session it removed after a refresh it couldn't use (e.g. /token
  // answering 200 {} or failing), including when it answers from its own cache of a recent failure without asking
  // again. Only this client's evidence (refresh and /user answers about its current session) tells them apart:
  //   - a definitive code in the evidence → definitive (the same codes as when the error carries one);
  //   - no evidence at all (nothing asked about a session; failed sign-ins don't count) → there was none;
  //   - evidence, but nothing in it said the session is gone → unknown, so temporary.
  if (definitiveCode(error, log) !== null) return "definitive";
  if (isAuthSessionMissingError(error)) return sessionEvidence(log).length === 0 ? "no-session" : "temporary";
  return "temporary";
}
