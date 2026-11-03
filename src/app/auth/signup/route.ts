import { authPost, captchaFrom, codeOf, CookieWrites, emailBucket, emailFrom, enforceLimits, failure, freshClient, isRateLimited, noSoonerThan, refuse, reply, requireCaptcha, statusOf, type SupabaseError } from "@/lib/auth/route";
import { passwordProblem } from "@/lib/auth/password-policy";
import { clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /auth/signup { email, password, captchaToken } → {}
// errors: invalid_input (field), weak_password, captcha_failed, rate_limited, unavailable, disabled (+ blocked)
// The CAPTCHA is checked here after the per-IP and per-address limits, then the global email cap (shared with
// resend and forgot). Neither depends on whether the address has an account.
// The answer is the same for a new address and one that already has an account (Supabase sends a confirmation email
// to the first and nothing to the second): every outcome that could depend on the address is a plain {}, and every
// answer after the limits waits out the same minimum time (noSoonerThan). No cookie is ever set: a new account
// confirms its email before it can sign in, whatever Supabase's own setting says.
export const POST = authPost(async (ctx, body) => {
  const started = Date.now();
  const email = emailFrom(body);
  const password = body.password;
  if (typeof password !== "string") refuse(failure(400, "invalid_input", { field: "password" }));
  const problem = passwordProblem(password as string);
  if (problem === "too-short") refuse(failure(422, "weak_password", { field: "password" }));
  if (problem) refuse(failure(400, "invalid_input", { field: "password" }));
  const captchaToken = captchaFrom(body);
  await enforceLimits([
    { bucket: "signup:ip", key: clientIp(ctx.req.headers) },
    { bucket: "signup:email", key: emailBucket(ctx, email) },
  ]);
  await requireCaptcha(ctx, captchaToken, "signup");
  await enforceLimits([{ bucket: "email:global", key: "all" }]);

  const { error } = await freshClient(ctx, new CookieWrites()).auth.signUp({ email, password: password as string });
  const res = signupOutcome(error);
  await noSoonerThan(started);
  return res;
});

function signupOutcome(error: SupabaseError) {
  if (!error) return reply({});
  switch (codeOf(error)) {
    // Checked by Supabase before it looks the address up, so they say nothing about it.
    case "weak_password":
      return failure(422, "weak_password", { field: "password" });
    case "email_address_invalid":
    case "validation_failed":
      return failure(400, "invalid_input", { field: "email" });
    case "captcha_failed":
      return failure(403, "blocked");
    case "signup_disabled":
    case "email_provider_disabled":
      return failure(404, "disabled");
    // The address already has an account: the same answer as a new one.
    case "user_already_exists":
    case "email_exists":
      return reply({});
  }
  // Everything else can depend on the address: Supabase's email limits count emails it actually sent, and a failed or
  // slow confirmation email happens only for new addresses. So all of it reads as done; failures are logged instead.
  const status = statusOf(error);
  if (!isRateLimited(error) && !(status >= 400 && status < 500 && status !== 408)) {
    console.error("[accounts] sign-up failed at Supabase:", status || "no answer", codeOf(error) ?? "");
  }
  return reply({});
}
