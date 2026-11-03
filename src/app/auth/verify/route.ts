import { issueRecoveryMarker, RECOVERY_COOKIE, recoveryCookieOptions } from "@/lib/auth/recovery-marker";
import { authPost, codeOf, CookieWrites, enforceLimits, failure, freshClient, isRateLimited, isSessionCookie, refuse, reply, statusOf, unavailable, type AuthContext, type SupabaseError } from "@/lib/auth/route";
import { tokenClaims } from "@/lib/auth/server-session";
import { checkLimits } from "@/lib/ratelimit";
import { LIMIT_TIMEOUT_MS, readStoredSession } from "@/lib/supabase/middleware";
import { checkChecks, proveAccessToken } from "@/lib/supabase/token-proof";
import type { VerifyType } from "@/lib/auth/client";
import { clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: readonly VerifyType[] = ["signup", "email", "recovery"];
/** Supabase's token hashes are hex (optionally "pkce_"-prefixed); this only keeps out junk and huge values. */
const TOKEN_HASH = /^[A-Za-z0-9_-]{8,512}$/;

// POST /auth/verify { tokenHash, type, replaceSession? } → { userId, email, type }
// errors: link_invalid, link_expired, switch_required, rate_limited, unavailable (+ disabled)
// Opens an email link (/auth/confirm reads the token from the URL fragment and posts it here). Like sign-in, the
// client starts without the request's cookies and its session replaces theirs on success. Only a recovery link's
// session gets the recovery marker that /auth/update-password requires.
//
// M3: an emailed link must never silently replace the account this browser is signed in to (someone could send a
// student a valid link for THEIR account). Supabase's verify uses the link up, so its account can't be looked up
// first; instead, while the request carries a session, the link is only used with replaceSession: true, which the
// confirm screen sends after the student pressed "Sign out and continue" on a screen naming the current account.
// Without it: 409 switch_required, before anything is counted or Supabase is asked, so the link still works. With
// it, after the link worked, the old session is also revoked at Supabase (see revokeOldSession).
export const POST = authPost(async (ctx, body) => {
  const { tokenHash, type } = body;
  if (typeof tokenHash !== "string" || !TOKEN_HASH.test(tokenHash) || !TYPES.includes(type as VerifyType)) refuse(failure(400, "link_invalid"));
  if (body.replaceSession !== undefined && typeof body.replaceSession !== "boolean") refuse(failure(400, "invalid_input"));
  const holdsSession = ctx.req.cookies.getAll().some((c) => isSessionCookie(c.name, ctx.cookieKey) && !c.name.endsWith("-code-verifier"));
  if (holdsSession && body.replaceSession !== true) refuse(failure(409, "switch_required"));
  await enforceLimits([{ bucket: "verify:ip", key: clientIp(ctx.req.headers) }]);
  await enforceLimits([{ bucket: "verify:global", key: "all" }]);

  const { writes } = ctx;
  const { data, error } = await freshClient(ctx, writes).auth.verifyOtp({ token_hash: tokenHash as string, type: type as VerifyType });
  if (error) return verifyFailure(error);
  if (!data.session || !data.user?.id) return unavailable();
  if (holdsSession) await revokeOldSession(ctx);
  writes.replaceSession(ctx);
  // Only a recovery link may set a password: mark this new session as one (bound to its id and user), and clear any
  // older marker otherwise. Both come straight from Supabase's answer to this verify call.
  const sessionId = tokenClaims(data.session.access_token)?.session_id;
  const marker = type === "recovery" && typeof sessionId === "string" ? issueRecoveryMarker(ctx.config.rateLimitSecret, data.user.id, sessionId) : null;
  if (type === "recovery" && !marker) return unavailable(); // can't mark it: refuse rather than leave a reset that can't finish
  if (marker) writes.setCookie(RECOVERY_COOKIE, marker, recoveryCookieOptions(ctx.https));
  else if (ctx.req.cookies.get(RECOVERY_COOKIE)) writes.setCookie(RECOVERY_COOKIE, "", recoveryCookieOptions(ctx.https, 0));
  return writes.all(reply({ userId: data.user.id, email: data.user.email ?? "", type }));
});

/**
 * The student agreed to sign out of the account this browser held: revoke that session at Supabase (POST /logout,
 * scope "local": that session only), with its own access token, never by refreshing it first. A refresh here would be
 * the stale-cookie refresh the sign-in routes avoid (S1.2a), so a session whose access token has already expired is
 * left as it is (its cookies are replaced either way). Also only for a token this project really issued, and within
 * the session-check limits. Best effort: a failure never undoes the link that was just used, and nothing this client
 * writes reaches the browser.
 */
async function revokeOldSession(ctx: AuthContext) {
  try {
    const stored = await readStoredSession(ctx.req.cookies.getAll(), ctx.cookieKey);
    const token = typeof stored === "object" && typeof stored.access_token === "string" ? stored.access_token : null;
    if (!token) return;
    const proof = await proveAccessToken(token, ctx.config, { deadline: ctx.deadline });
    if (proof.kind === "forged") return;
    const exp = tokenClaims(token)?.exp;
    if (typeof exp !== "number" || exp - Date.now() / 1000 < REVOKE_MIN_LEFT_S) return;
    if (!(await checkLimits(checkChecks(proof, ctx.req.headers), LIMIT_TIMEOUT_MS)).ok) return;
    await freshClient(ctx, new CookieWrites()).auth.admin.signOut(token, "local");
  } catch (e) {
    console.error("[accounts] revoking the replaced session failed:", e instanceof Error ? e.name : "unknown");
  }
}
/** Don't try to revoke with an access token about to expire on the way. */
const REVOKE_MIN_LEFT_S = 10;

function verifyFailure(error: SupabaseError) {
  if (isRateLimited(error)) return failure(429, "rate_limited");
  // Supabase answers otp_expired both for a used link and an expired one.
  if (codeOf(error) === "otp_expired") return failure(400, "link_expired");
  const status = statusOf(error);
  if (status >= 400 && status < 500 && status !== 408) return failure(400, "link_invalid");
  return unavailable();
}
