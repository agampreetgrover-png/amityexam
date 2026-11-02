import { issueRecoveryMarker, RECOVERY_COOKIE, recoveryCookieOptions } from "@/lib/auth/recovery-marker";
import { authPost, codeOf, enforceLimits, failure, freshClient, isRateLimited, refuse, reply, statusOf, unavailable, type SupabaseError } from "@/lib/auth/route";
import { tokenClaims } from "@/lib/auth/server-session";
import type { VerifyType } from "@/lib/auth/client";
import { clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: readonly VerifyType[] = ["signup", "email", "recovery"];
/** Supabase's token hashes are hex (optionally "pkce_"-prefixed); this only keeps out junk and huge values. */
const TOKEN_HASH = /^[A-Za-z0-9_-]{8,512}$/;

// POST /auth/verify { tokenHash, type } → { userId, email, type }
// errors: link_invalid, link_expired, rate_limited, unavailable (+ disabled)
// Opens an email link (/auth/confirm reads the token from the URL fragment and posts it here). Like sign-in, the
// client starts without the request's cookies and its session replaces theirs on success. Only a recovery link's
// session gets the recovery marker that /auth/update-password requires.
export const POST = authPost(async (ctx, body) => {
  const { tokenHash, type } = body;
  if (typeof tokenHash !== "string" || !TOKEN_HASH.test(tokenHash) || !TYPES.includes(type as VerifyType)) refuse(failure(400, "link_invalid"));
  await enforceLimits([{ bucket: "verify:ip", key: clientIp(ctx.req.headers) }]);

  const { writes } = ctx;
  const { data, error } = await freshClient(ctx, writes).auth.verifyOtp({ token_hash: tokenHash as string, type: type as VerifyType });
  if (error) return verifyFailure(error);
  if (!data.session || !data.user?.id) return unavailable();
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

function verifyFailure(error: SupabaseError) {
  if (isRateLimited(error)) return failure(429, "rate_limited");
  // Supabase answers otp_expired both for a used link and an expired one.
  if (codeOf(error) === "otp_expired") return failure(400, "link_expired");
  const status = statusOf(error);
  if (status >= 400 && status < 500 && status !== 408) return failure(400, "link_invalid");
  return unavailable();
}
