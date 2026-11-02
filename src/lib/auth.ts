import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callLogOf } from "./supabase/server";
import { classifyAuthError, definitiveCode } from "./supabase/session-policy";

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
  /** No session, or one Supabase definitely no longer accepts (revoked, expired, user deleted or banned, bad token). */
  | { status: "signed-out"; code: string }
  /** Not confirmed either way (network, timeout, rate limit, 5xx, an unexpected answer). Nothing may be opened. */
  | { status: "unavailable" };

/**
 * `jwt`: check exactly this access token (e.g. the one whose claims the caller is about to read) instead of the
 * session the client loads from the cookies.
 */
export async function verifyUser(supabase: SupabaseClient, jwt?: string): Promise<Verification> {
  let result: Awaited<ReturnType<SupabaseClient["auth"]["getUser"]>>;
  try {
    result = await supabase.auth.getUser(jwt);
  } catch {
    return { status: "unavailable" };
  }
  const { data, error } = result;
  if (error) {
    // The same rule as the middleware (src/lib/supabase/session-policy.ts): signed out only when Supabase said the
    // session is definitely gone, or there was none. Anything else (network, timeout, 408, 429, 5xx, an answer that
    // couldn't be read, an error we don't know) is unknown: telling a student they're signed out because Supabase was
    // busy would be wrong, and opening anything without a confirmed user would be worse.
    // The code reported is the one Supabase actually gave (on this call, or on the refresh auth-js ran by itself), so
    // expired, revoked, banned and deleted stay distinguishable.
    const log = callLogOf(supabase);
    const verdict = classifyAuthError(error, log);
    if (verdict === "definitive") return { status: "signed-out", code: definitiveCode(error, log) ?? "session_not_found" };
    if (verdict === "no-session") return { status: "signed-out", code: "session_missing" };
    return { status: "unavailable" };
  }
  const u = data.user;
  // A success without a user isn't something Supabase should send; it confirms nobody, so it's treated as unknown.
  if (!u?.id) return { status: "unavailable" };
  return { status: "ok", user: { id: u.id, email: u.email ?? null, emailVerified: !!u.email_confirmed_at } };
}

/** The verified user, or null for anything else (signed out or unknown). For routes that must refuse both. */
export async function requireUser(supabase: SupabaseClient): Promise<VerifiedUser | null> {
  const v = await verifyUser(supabase);
  return v.status === "ok" ? v.user : null;
}
