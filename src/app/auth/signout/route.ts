import { RECOVERY_COOKIE, recoveryCookieOptions } from "@/lib/auth/recovery-marker";
import { authPost, isSessionCookie, reply, sessionClient } from "@/lib/auth/route";
import { refreshAllowed } from "@/lib/auth/server-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /auth/signout {} → {}
// Ends this browser's session: Supabase is asked to revoke it (scope "local": this session only), and this
// project's session cookies (and a recovery marker, if any) are deleted whatever Supabase answers, so signing out
// always works here, offline or not. Only those cookies: the APP_PASSWORD cookie and everything else stay (no
// Clear-Site-Data). Nothing on the device is touched either: the account's data stays in its own IndexedDB
// database (S1.2d clears caches and memory, and offers removing that data as an explicit choice).
export const POST = authPost(async (ctx) => {
  const { writes } = ctx;
  const hasSession = ctx.req.cookies.getAll().some((c) => isSessionCookie(c.name, ctx.cookieKey));
  // Revoking needs a valid access token, so an expiring session would be refreshed first: only within the refresh
  // limits. If that is refused or Supabase can't be reached, the cookies are still deleted here; the session then
  // stays valid at Supabase (refresh tokens don't expire by default) until revoked another way, e.g. by D6 or
  // "sign out everywhere", but this browser no longer holds it.
  if (hasSession && (await refreshAllowed(ctx))) {
    try {
      await sessionClient(ctx, writes).auth.signOut({ scope: "local" });
    } catch (e) {
      console.error("[accounts] sign-out revoke failed:", e instanceof Error ? e.name : "unknown");
    }
  }
  writes.deleteSession(ctx);
  if (ctx.req.cookies.get(RECOVERY_COOKIE)) writes.setCookie(RECOVERY_COOKIE, "", recoveryCookieOptions(ctx.https, 0));
  return writes.deletionsOnly(reply({}));
});
