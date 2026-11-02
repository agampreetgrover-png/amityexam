import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyUser } from "@/lib/auth";
import { passwordProblem } from "@/lib/auth/password-policy";
import { RECOVERY_COOKIE, recoveryCookieOptions, recoveryMarkerValid } from "@/lib/auth/recovery-marker";
import { authPost, codeOf, enforceLimits, failure, isRateLimited, refuse, reply, sessionClient, unavailable, type AuthContext, type SupabaseError } from "@/lib/auth/route";
import { refreshAllowed, tokenClaims } from "@/lib/auth/server-session";
import { clientIp } from "@/lib/ratelimit";
import { callLogOf } from "@/lib/supabase/server";
import { classifyAuthError } from "@/lib/supabase/session-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /auth/update-password { password, expectedUserId } → {}
// errors: session_missing, user_mismatch, weak_password, same_password, rate_limited (+ invalid_input, unavailable)
// Only for the session the browser holds, and only when that session came from a password-recovery link opened in
// this browser within the last 15 minutes (the recovery marker, src/lib/auth/recovery-marker.ts): an ordinary or
// old session, or one picked up from an unlocked laptop, can't change the password.
//   1. getSession() loads (and if needed refreshes, within the refresh limits) the session; getUser() then checks
//      exactly that access token, so the claims read from it (session id, subject) are ones Supabase just accepted.
//   2. expectedUserId is never taken as who anyone is: it is only compared with the verified user, so a page opened
//      for one account can't change another's password after a switch in another tab.
//   3. D6: the account's other sessions are signed out BEFORE the change (if that fails, nothing has changed and a
//      retry works) and once more after it (best effort), so a session started in between is caught too.
export const POST = authPost(async (ctx, body) => {
  const { password, expectedUserId } = body;
  if (typeof password !== "string") refuse(failure(400, "invalid_input", { field: "password" }));
  const problem = passwordProblem(password as string);
  if (problem === "too-short") refuse(failure(422, "weak_password", { field: "password" }));
  if (problem) refuse(failure(400, "invalid_input", { field: "password" }));
  if (typeof expectedUserId !== "string" || !expectedUserId || expectedUserId.length > 128) refuse(failure(400, "invalid_input"));
  await enforceLimits([{ bucket: "reset:ip", key: clientIp(ctx.req.headers) }]);
  if (!(await refreshAllowed(ctx))) return unavailable();

  const { writes } = ctx;
  const supabase = sessionClient(ctx, writes);
  const loaded = await supabase.auth.getSession();
  if (loaded.error) {
    if (classifyAuthError(loaded.error, callLogOf(supabase)) === "temporary") return writes.saves(unavailable());
    return writes.signedOut(ctx, failure(401, "session_missing"));
  }
  const token = loaded.data.session?.access_token;
  if (!token) return writes.signedOut(ctx, failure(401, "session_missing"));
  const v = await verifyUser(supabase, token);
  if (v.status === "unavailable") return writes.saves(unavailable());
  if (v.status === "signed-out") return writes.signedOut(ctx, failure(401, "session_missing"));

  // From here on the session is confirmed, so whatever Supabase wrote (a rotated session) is always kept.
  if (v.user.id !== expectedUserId) return writes.all(failure(409, "user_mismatch"));
  const claims = tokenClaims(token);
  const sessionId = typeof claims?.session_id === "string" ? claims.session_id : "";
  const marker = ctx.req.cookies.get(RECOVERY_COOKIE)?.value;
  if (claims?.sub !== v.user.id || !recoveryMarkerValid(marker, ctx.config.rateLimitSecret, v.user.id, sessionId)) {
    return writes.all(failure(401, "session_missing"));
  }

  if (!(await signOutOthers(supabase, token))) return writes.all(unavailable());
  const { error } = await supabase.auth.updateUser({ password: password as string });
  if (error) return writes.all(updateFailure(error, supabase));
  await signOutOthers(supabase, token);
  return writes.all(markerUsed(ctx, reply({})));
});

/**
 * D6: end every other session of this account. True only when Supabase answered with success: called through the
 * admin API's signOut(jwt, scope), which reports every error (auth.signOut would treat a 401/403/404 as done).
 */
async function signOutOthers(supabase: SupabaseClient, token: string): Promise<boolean> {
  try {
    const { error } = await supabase.auth.admin.signOut(token, "others");
    return !error;
  } catch {
    return false;
  }
}

/** The marker works once: deleted with the successful change. */
function markerUsed<T extends Parameters<AuthContext["writes"]["all"]>[0]>(ctx: AuthContext, res: T): T {
  ctx.writes.setCookie(RECOVERY_COOKIE, "", recoveryCookieOptions(ctx.https, 0));
  return res;
}

function updateFailure(error: SupabaseError, supabase: SupabaseClient) {
  switch (codeOf(error)) {
    case "same_password":
      return failure(422, "same_password", { field: "password" });
    case "weak_password":
      return failure(422, "weak_password", { field: "password" });
    // Supabase's "secure password change" wants a fresh sign-in: to the student, the reset session has ended.
    case "reauthentication_needed":
    case "reauthentication_not_valid":
      return failure(401, "session_missing");
  }
  if (isRateLimited(error)) return failure(429, "rate_limited");
  if (classifyAuthError(error, callLogOf(supabase)) !== "temporary") return failure(401, "session_missing");
  return unavailable();
}
