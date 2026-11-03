import type { NextRequest } from "next/server";
import { verifyUser } from "@/lib/auth";
import { contextFor, isSessionCookie, reply, sessionClient } from "@/lib/auth/route";
import { sessionGate, signedOutReason } from "@/lib/auth/server-session";
import { accountsConfig } from "@/lib/supabase/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /auth/session → SessionInfo (src/lib/auth/client.ts). Who is signed in, as Supabase Auth says right now
// (getUser), never as the cookie says. "Signed out" is a state, not an error: every answer is 200.
//   verified    → the user Supabase vouches for; a session refreshed on the way is written back.
//   signed-out  → no session, one Supabase definitely no longer accepts, or a cookie whose access token this project
//                 never issued (checked here, without asking Supabase): its cookies are deleted.
//   unavailable → not known (Supabase or the rate-limit store not answering): no cookie is removed, but a session
//                 that was rotated on the way is still written back (or the browser would keep a used token).
export async function GET(req: NextRequest) {
  const config = accountsConfig();
  if (!config.enabled) return reply({ state: "disabled" });
  const ctx = contextFor(req, config);
  if (!req.cookies.getAll().some((c) => isSessionCookie(c.name, ctx.cookieKey) && !c.name.endsWith("-code-verifier"))) {
    return reply({ state: "signed-out", reason: "none" });
  }
  const { writes } = ctx;
  try {
    // M1/M2: a forged cookie is signed out without asking Supabase; everything else is asked only within the limits.
    const gate = await sessionGate(ctx);
    if (gate === "forged") return writes.signedOut(ctx, reply({ state: "signed-out", reason: "none" }));
    if (gate === "refused") return reply({ state: "unavailable" });
    const v = await verifyUser(sessionClient(ctx, writes));
    if (v.status === "unavailable") return writes.saves(reply({ state: "unavailable" }));
    if (v.status === "signed-out") return writes.signedOut(ctx, reply({ state: "signed-out", reason: signedOutReason(v.code) }));
    return writes.all(reply({ state: "verified", user: v.user, verifiedAt: new Date().toISOString() }));
  } catch (e) {
    console.error("[accounts] session check failed:", e instanceof Error ? e.name : "unknown");
    return writes.saves(reply({ state: "unavailable" }));
  }
}
