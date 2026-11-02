import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { CookieOptions } from "@supabase/ssr";
import { isVercel } from "@/lib/vercel";

// Proof that a session came from a password-recovery link, kept by this server rather than read from Supabase's token.
// (The access token's "amr" can't be relied on: as far as we know, opening a link by its token hash records "otp"
// whatever the link's type, the same as a magic link or a sign-up confirmation, and those must not set a password.)
//
// POST /auth/verify sets it ONLY after Supabase accepted a link of type "recovery": an HttpOnly cookie holding an
// expiry and an HMAC of (user id, the new session's id, expiry). POST /auth/update-password accepts a change only when
// the marker is valid for the verified user AND the session id inside the access token Supabase just accepted: a
// marker can't be moved to another session or account, or used after RECOVERY_WINDOW_S, and it is deleted once used.

export const RECOVERY_COOKIE = "amityexams-recovery";
/** How long after opening a recovery link the new password may be set. */
export const RECOVERY_WINDOW_S = 15 * 60;

const PURPOSE = "amityexams recovery marker v1";
let localKey: Buffer | null = null;

/**
 * The signing key: derived from RATE_LIMIT_SECRET for this one purpose (a separate HMAC domain). On Vercel the secret
 * is required (accounts are off without a 32+ character one), so null there means "can't mark: refuse". Only on this
 * computer, with one process, does a random per-process key stand in.
 */
function signingKey(secret: string | null): Buffer | null {
  if (secret && (secret.length >= 32 || !isVercel())) return createHmac("sha256", secret).update(PURPOSE).digest();
  if (isVercel()) return null;
  return (localKey ??= randomBytes(32));
}

const mac = (key: Buffer, userId: string, sessionId: string, exp: number) =>
  createHmac("sha256", key).update(`${userId}\n${sessionId}\n${exp}`).digest("base64url");

/** The marker's value for this user and session, or null when no key is available. */
export function issueRecoveryMarker(secret: string | null, userId: string, sessionId: string, nowS = Date.now() / 1000): string | null {
  const key = signingKey(secret);
  if (!key || !userId || !sessionId) return null;
  const exp = Math.floor(nowS) + RECOVERY_WINDOW_S;
  return `${exp}.${mac(key, userId, sessionId, exp)}`;
}

/** Whether `value` is an unexpired marker for exactly this user and session. */
export function recoveryMarkerValid(value: string | undefined, secret: string | null, userId: string, sessionId: string, nowS = Date.now() / 1000): boolean {
  const key = signingKey(secret);
  if (!key || !value || !userId || !sessionId) return false;
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!m) return false;
  const exp = Number(m[1]);
  if (exp < nowS || exp > nowS + RECOVERY_WINDOW_S + 60) return false;
  const expected = Buffer.from(mac(key, userId, sessionId, exp));
  const given = Buffer.from(m[2]);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Sent only to /auth/* (where update-password lives), never readable by scripts, never cross-site. */
export const recoveryCookieOptions = (https: boolean, maxAge = RECOVERY_WINDOW_S): CookieOptions => ({
  httpOnly: true,
  secure: https,
  sameSite: "strict",
  path: "/auth",
  maxAge,
});
