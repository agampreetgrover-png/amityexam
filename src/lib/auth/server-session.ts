import "server-only";
import { checkLimits } from "@/lib/ratelimit";
import { LIMIT_TIMEOUT_MS, readStoredSession, REFRESH_MARGIN_S } from "@/lib/supabase/middleware";
import { checkChecks, proveAccessToken, refreshChecks } from "@/lib/supabase/token-proof";
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
 * Whether a route may let Supabase's client loose on the request's session:
 *   "open"    yes (or there is no session cookie, so auth-js won't ask Supabase anything);
 *   "refused" the limits refused, or the store couldn't answer (fail closed): answer "unavailable", change nothing;
 *   "forged"  the access token is not one this project issued (token-proof.ts), or the cookie isn't a session at all:
 *             signed out, without asking Supabase or spending any budget.
 * Every call auth-js makes leaves from this server's IPs, so none may happen unlimited:
 *   - a possible REFRESH (one POST /token) uses the refresh buckets: auth-js refreshes on any truthy expires_at
 *     ("1", true, [1]…) it reads as past, so anything but a numeric expires_at beyond the refresh margin counts;
 *   - otherwise the session is only CHECKED (one GET /user or POST /logout), with the check buckets (M2: a made-up
 *     cookie with a far-future expires_at used to skip every limit and reach /user each time).
 * Only a verified session (signed by the project's published key) gets the main buckets; one that can't be checked
 * here shares a small budget of its own.
 */
export type SessionGate = "open" | "refused" | "forged";

export async function sessionGate(ctx: AuthContext): Promise<SessionGate> {
  const s = await readStoredSession(ctx.req.cookies.getAll(), ctx.cookieKey);
  if (s === "none") return "open";
  if (s === "unreadable") return "forged"; // auth-js can't read it either: nothing there for Supabase to answer about
  const proof = await proveAccessToken(s.access_token, ctx.config, { deadline: ctx.deadline });
  if (proof.kind === "forged") return "forged";
  const fresh = typeof s.expires_at === "number" && Number.isFinite(s.expires_at) && s.expires_at - Date.now() / 1000 > REFRESH_MARGIN_S;
  const r = await checkLimits(fresh ? checkChecks(proof, ctx.req.headers) : refreshChecks(proof, ctx.req.headers), LIMIT_TIMEOUT_MS);
  return r.ok ? "open" : "refused";
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
