import "server-only";
import { isAuthRetryableFetchError, isAuthSessionMissingError, type SupabaseClient } from "@supabase/supabase-js";

// Who is signed in, decided on the server and only on the server.
//   getUser()    asks Supabase Auth itself: catches revoked sessions, deleted and banned users. Used for every
//                decision that matters: opening an account's database (GET /auth/session), changing a password,
//                signing out, and later keys, sync and account deletion.
//   getClaims()  checks the token's signature without asking the server, so a revoked session passes until its
//                access token expires. Not used.
//   getSession() reads the session from the cookies without checking it. The middleware uses it only to refresh an
//                expiring session (src/lib/supabase/middleware.ts); it is never trusted to say who anyone is.
// A user id is never taken from the request: only from what Supabase returns here.

export interface VerifiedUser {
  id: string;
  email: string | null;
  emailVerified: boolean;
}

export type Verification =
  | { status: "ok"; user: VerifiedUser }
  /** No session, or one Supabase no longer accepts (expired, revoked, user deleted or banned). Clear the cookies. */
  | { status: "signed-out"; code: string }
  /** Supabase couldn't be asked or couldn't answer (network, timeout, rate limit, 5xx). Unknown, so nothing may be opened. */
  | { status: "unavailable" };

export async function verifyUser(supabase: SupabaseClient): Promise<Verification> {
  let result: Awaited<ReturnType<SupabaseClient["auth"]["getUser"]>>;
  try {
    result = await supabase.auth.getUser();
  } catch {
    return { status: "unavailable" };
  }
  const { data, error } = result;
  if (error) {
    if (isAuthSessionMissingError(error)) return { status: "signed-out", code: "session_missing" };
    // We don't know, so it's neither "signed in" nor "signed out": network failures, timeouts (408), Supabase's rate
    // limit (429), an answer it couldn't parse (AuthUnknownError) and Supabase's own errors (5xx). Telling a student
    // they're signed out because Supabase was busy would be wrong.
    if (
      isAuthRetryableFetchError(error) ||
      error.name === "AuthUnknownError" ||
      !error.status ||
      error.status === 408 ||
      error.status === 429 ||
      error.status >= 500
    ) {
      return { status: "unavailable" };
    }
    return { status: "signed-out", code: error.code ?? `http_${error.status}` };
  }
  const u = data.user;
  if (!u?.id) return { status: "signed-out", code: "no_user" };
  return { status: "ok", user: { id: u.id, email: u.email ?? null, emailVerified: !!u.email_confirmed_at } };
}

/** The verified user, or null for anything else (signed out or unknown). For routes that must refuse both. */
export async function requireUser(supabase: SupabaseClient): Promise<VerifiedUser | null> {
  const v = await verifyUser(supabase);
  return v.status === "ok" ? v.user : null;
}
