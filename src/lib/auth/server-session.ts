import "server-only";
import { combineChunks, stringFromBase64URL } from "@supabase/ssr";
import { checkLimits, clientIp } from "@/lib/ratelimit";
import { LIMIT_TIMEOUT_MS, REFRESH_MARGIN_S } from "@/lib/supabase/middleware";
import type { SignedOutReason } from "./client";
import type { AuthContext } from "./route";

// Server-side facts about the session a request carries, for the /auth/* routes.

/**
 * Why a session ended, as the sign-in screens explain it (copy.ts), from the code Supabase gave (verifyUser):
 *   revoked: signed out elsewhere, the password changed (D6 signs other sessions out), or a refresh token reused;
 *   expired: the session timed out, or its token can't be read;
 *   deleted / banned: the account itself; none: there was no session.
 */
export function signedOutReason(code: string): SignedOutReason {
  switch (code) {
    case "session_not_found":
    case "refresh_token_not_found":
    case "refresh_token_already_used":
      return "revoked";
    case "session_expired":
    case "bad_jwt":
      return "expired";
    case "user_not_found":
      return "deleted";
    case "user_banned":
      return "banned";
    default:
      return "none";
  }
}

/**
 * The stored session exactly as @supabase/ssr hands it to auth-js (same chunk and base64 handling), parsed; "none"
 * when there is no session cookie at all; "unreadable" when it is there but isn't a JSON object.
 */
async function storedSession(ctx: AuthContext): Promise<Record<string, unknown> | "none" | "unreadable"> {
  const cookies = ctx.req.cookies.getAll();
  try {
    const raw = await combineChunks(ctx.cookieKey, (name) => cookies.find((c) => c.name === name)?.value);
    if (!raw) return "none";
    const value: unknown = JSON.parse(raw.startsWith("base64-") ? stringFromBase64URL(raw.slice("base64-".length)) : raw);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : "unreadable";
  } catch {
    return "unreadable";
  }
}

/**
 * Whether a route may let Supabase's client loose on the request's session. Every refresh leaves from this server's
 * IPs and shares Supabase's per-IP /token budget, so whenever one COULD happen, the middleware's refresh limits apply
 * first (a store that can't answer refuses). Only a session that plainly needs no refresh skips them: a numeric
 * expires_at further away than the refresh margin. Anything else counts as a possible refresh, because auth-js
 * refreshes on any truthy expires_at ("1", true, [1]…) it reads as past, and a cookie is whatever the client sends.
 */
export async function refreshAllowed(ctx: AuthContext): Promise<boolean> {
  const s = await storedSession(ctx);
  if (s === "none") return true; // nothing to refresh
  if (s !== "unreadable" && typeof s.expires_at === "number" && Number.isFinite(s.expires_at) && s.expires_at - Date.now() / 1000 > REFRESH_MARGIN_S) return true;
  const r = await checkLimits(
    [
      { bucket: "session:ip", key: clientIp(ctx.req.headers) },
      { bucket: "session:global", key: "all" },
    ],
    LIMIT_TIMEOUT_MS,
  );
  return r.ok;
}

/** The claims of an access token, read without checking its signature: callers only use tokens Supabase vouched for. */
export function tokenClaims(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return claims && typeof claims === "object" && !Array.isArray(claims) ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
