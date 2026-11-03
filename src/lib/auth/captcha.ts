import "server-only";
import { isTurnstileTestKey } from "@/lib/supabase/env";
import type { CaptchaAction } from "./client";

// Cloudflare Turnstile, checked by this server (H1). Supabase's own CAPTCHA setting can't be seen from here, so it
// can't be relied on: with the check here, accounts can't run without a CAPTCHA at all (env.ts refuses to turn them on
// without TURNSTILE_SECRET_KEY). A token works only once, so it is NOT passed on to Supabase, whose CAPTCHA setting
// must stay off.
//
// What counts as passed: Cloudflare answered success, for the action this form asked for (login, signup, resend,
// forgot), on this site's host name. Everything else is refused, and when Cloudflare can't be asked (network,
// timeout, 5xx, an answer we can't read) the request is refused as "unavailable": it fails closed.

export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Cloudflare usually answers in well under a second. */
export const CAPTCHA_TIMEOUT_MS = 3000;
/** Cloudflare's tokens are at most 2048 characters. */
export const MAX_CAPTCHA_TOKEN_CHARS = 2048;

/** The form a token was made for: set as the widget's `action`, and checked against Cloudflare's answer. */
export type { CaptchaAction };

export type CaptchaResult = "ok" | "failed" | "unavailable";

/** Cloudflare's error codes that mean its side failed, not the token. */
const CLOUDFLARE_FAULTS = new Set(["internal-error"]);

export async function verifyCaptcha({
  secret,
  token,
  action,
  hostname,
  deadline,
}: {
  secret: string;
  token: string;
  action: CaptchaAction;
  /** The host name the request was made to (its Host header, without a port). */
  hostname: string;
  deadline?: AbortSignal;
}): Promise<CaptchaResult> {
  if (!token || token.length > MAX_CAPTCHA_TOKEN_CHARS) return "failed";
  const signal = AbortSignal.any([AbortSignal.timeout(CAPTCHA_TIMEOUT_MS), ...(deadline ? [deadline] : [])]);
  let res: Response;
  try {
    res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }).toString(),
      signal,
      cache: "no-store",
    });
  } catch {
    return "unavailable";
  }
  if (!res.ok) return "unavailable";
  let body: { success?: unknown; action?: unknown; hostname?: unknown; "error-codes"?: unknown };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return "unavailable";
  }
  if (!body || typeof body !== "object") return "unavailable";
  if (body.success !== true) {
    const codes = Array.isArray(body["error-codes"]) ? body["error-codes"] : [];
    return codes.some((c) => typeof c === "string" && CLOUDFLARE_FAULTS.has(c)) ? "unavailable" : "failed";
  }
  // Cloudflare's test secrets answer for any site and no action (hostname "example.com"); they are refused in
  // Production by env.ts, so only there are these two checks skipped.
  if (isTurnstileTestKey(secret)) return "ok";
  if (body.action !== action) return "failed";
  if (typeof body.hostname !== "string" || body.hostname.toLowerCase() !== hostname.toLowerCase()) return "failed";
  return "ok";
}

/** The request's host name (Host header without its port; IPv6 keeps no brackets, as Cloudflare reports it). */
export function requestHostname(host: string): string {
  try {
    return new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return "";
  }
}
