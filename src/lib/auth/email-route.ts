import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientIp, type Bucket } from "@/lib/ratelimit";
import { authPost, captchaFrom, codeOf, CookieWrites, emailBucket, emailFrom, enforceLimits, failure, freshClient, isRateLimited, noSoonerThan, reply, statusOf, type SupabaseError } from "./route";

// The two "send an email to this address" routes (/auth/resend, /auth/forgot). Whether the address has an account
// must not show in the answer or its timing: every outcome that could depend on it is a plain {}, and every answer
// after the rate limits waits out the same minimum time. What CAN be reported doesn't depend on the address: our own
// limits (per IP, per address), a bad address, a refused captcha. Even "Supabase not answering" can't be: see outcome().

type Send = (supabase: SupabaseClient, email: string, captchaToken: string | undefined) => Promise<{ error: SupabaseError }>;

export function emailOnlyRoute([ipBucket, emailBucketName]: [Bucket, Bucket], send: Send) {
  return authPost(async (ctx, body) => {
    const started = Date.now();
    const email = emailFrom(body);
    const captchaToken = captchaFrom(body);
    await enforceLimits([
      { bucket: ipBucket, key: clientIp(ctx.req.headers) },
      { bucket: emailBucketName, key: emailBucket(ctx, email) },
    ]);
    // No cookies are read or written: these routes have nothing to do with the browser's session.
    const { error } = await send(freshClient(ctx, new CookieWrites()), email, captchaToken);
    const res = outcome(error);
    await noSoonerThan(started);
    return res;
  });
}

function outcome(error: SupabaseError) {
  if (!error) return reply({});
  switch (codeOf(error)) {
    case "email_address_invalid":
    case "validation_failed":
      return failure(400, "invalid_input", { field: "email" });
    case "captcha_failed":
      return failure(403, "blocked");
  }
  // Everything else can depend on the address: Supabase's per-address email limits, "no such user", "already
  // confirmed", and even failures (sending is attempted only for some addresses, so a mail-server error or a slow send
  // that runs past the deadline shows up only for them). So all of it reads as sent; failures are logged here instead.
  if (!isRateLimited(error) && !(statusOf(error) >= 400 && statusOf(error) < 500 && statusOf(error) !== 408)) {
    console.error("[accounts] email request failed at Supabase:", statusOf(error) || "no answer", codeOf(error) ?? "");
  }
  return reply({});
}
