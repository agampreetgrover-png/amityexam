import { RECOVERY_COOKIE, recoveryCookieOptions } from "@/lib/auth/recovery-marker";
import { authPost, captchaFrom, codeOf, emailBucket, emailFrom, enforceLimits, failure, freshClient, isRateLimited, refuse, reply, requireCaptcha, statusOf, unavailable, type SupabaseError } from "@/lib/auth/route";
import { clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Old passwords may predate the policy, so sign-in only bounds the length (a hash is computed per attempt). */
const MAX_PASSWORD_CHARS = 1024;

// POST /auth/login { email, password, captchaToken } → { userId, email }
// errors: invalid_credentials, email_not_confirmed, captcha_failed, rate_limited, unavailable, disabled (+ invalid_input, blocked)
// Checks, in order: the per-IP limits, the CAPTCHA (this server checks it; it isn't passed on), then the global cap.
// Signs in with a client that starts WITHOUT the request's cookies (freshClient): a stale session in them can't be
// refreshed in the background and can't remove the new one. On success the new session replaces the old cookies;
// on any failure no cookie changes. The user id comes only from Supabase's answer.
export const POST = authPost(async (ctx, body) => {
  const email = emailFrom(body);
  const password = body.password;
  if (typeof password !== "string" || !password || password.length > MAX_PASSWORD_CHARS) refuse(failure(400, "invalid_input", { field: "password" }));
  const captchaToken = captchaFrom(body);
  const ip = clientIp(ctx.req.headers);
  await enforceLimits([
    { bucket: "login:ip", key: ip },
    { bucket: "login:ip-email", key: `${ip}:${emailBucket(ctx, email)}` },
  ]);
  await requireCaptcha(ctx, captchaToken, "login");
  await enforceLimits([{ bucket: "login:global", key: "all" }]);

  const { writes } = ctx;
  const { data, error } = await freshClient(ctx, writes).auth.signInWithPassword({ email, password: password as string });
  if (error) return loginFailure(error);
  if (!data.session || !data.user?.id) return unavailable();
  writes.replaceSession(ctx);
  // A recovery marker belongs to the session being replaced; it is useless now, so it goes too.
  if (ctx.req.cookies.get(RECOVERY_COOKIE)) writes.setCookie(RECOVERY_COOKIE, "", recoveryCookieOptions(ctx.https, 0));
  return writes.all(reply({ userId: data.user.id, email: data.user.email ?? email }));
});

function loginFailure(error: SupabaseError) {
  if (isRateLimited(error)) return failure(429, "rate_limited");
  switch (codeOf(error)) {
    case "invalid_credentials":
      return failure(400, "invalid_credentials");
    case "email_not_confirmed":
      return failure(400, "email_not_confirmed");
    case "user_banned":
    case "captcha_failed":
      return failure(403, "blocked");
    case "validation_failed":
    case "email_address_invalid":
      return failure(400, "invalid_input", { field: "email" });
  }
  // Supabase's long-standing answer for a wrong password without a code: 400 "Invalid login credentials".
  if (statusOf(error) === 400 && !codeOf(error)) return failure(400, "invalid_credentials");
  return unavailable();
}
