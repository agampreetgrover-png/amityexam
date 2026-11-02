import { NextResponse, type NextRequest } from "next/server";
import { appPassword, isValidSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/access";
import { authError, authRequestRefusal, isAuthPath } from "@/lib/auth/request-guard";
import { refreshSession } from "@/lib/supabase/middleware";
import { isVercel } from "@/lib/vercel";
import { safeNext, unlockPage } from "@/lib/unlock-page";

// Guards the API routes, which spend the AI keys:
// 1. Other websites can't call them. Without this, any page open in the same browser could POST to
//    http://127.0.0.1:3000/api/ai/… (a "simple" text/plain request needs no CORS preflight) and use up the quota.
// 2. Only known host names are served (stops DNS rebinding, where evil.example is pointed at 127.0.0.1).
// 3. With APP_PASSWORD set (for a deployed copy), the whole app asks for the password once per device.
// 4. A signed-in Supabase session (accounts) that is about to expire is refreshed here (route handlers calling
//    getUser() may refresh too when this was skipped). It decides no access by itself.
// 5. Non-GET /auth/* requests must be same-origin and JSON (see below).

const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

function hostAllowed(host: string): boolean {
  const name = host.toLowerCase().replace(/:\d+$/, "");
  // Only this computer's own addresses, plus ALLOWED_HOSTS. This is a browser defence (DNS rebinding: a page always
  // sends its own domain as Host). Host is whatever the client says, so it can't keep a script on the same Wi-Fi out
  // of a server listening on the LAN: that needs APP_PASSWORD, or the default 127.0.0.1-only bind.
  if (LOOPBACK.test(name)) return true;
  const allowed = (process.env.ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(name);
}

function crossSite(req: NextRequest, host: string): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  // Older browsers and scripts: fall back to Origin, which every cross-site POST carries.
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

const deny = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const host = req.headers.get("host") ?? "";
  const api = pathname.startsWith("/api/");
  const password = appPassword();

  if ((api || (pathname === "/unlock" && req.method === "POST")) && crossSite(req, host)) {
    return deny("Cross-site requests aren't allowed.", 403);
  }
  // 5. State-changing /auth/* requests: proven same-origin and JSON, before anything else runs (the handlers check
  //    again themselves: src/lib/auth/request-guard.ts).
  if (isAuthPath(pathname)) {
    const refusal = authRequestRefusal(req);
    if (refusal) return new NextResponse(refusal.body, refusal);
  }
  // Without a password, an expiring session is refreshed now and its cookies ride on every response below, the
  // refusals included. With APP_PASSWORD set, nothing (not even a refresh, which costs a call to Supabase) happens
  // until the password has been checked: see the end.
  const apply = password ? (res: NextResponse) => res : await refreshSession(req);
  const out = (r: Response) => apply(r instanceof NextResponse ? r : new NextResponse(r.body, r));
  // A Vercel copy is on the public internet: without a password anyone with the URL (or a script) could spend the
  // AI keys, so its API stays shut until APP_PASSWORD is set.
  if (api && !password && isVercel()) {
    return out(deny("This deployment has no APP_PASSWORD, so the AI and Drive features are off. Set APP_PASSWORD in the project's environment variables and redeploy.", 503));
  }
  // With a password, rebinding is already ruled out (the attacker has no session cookie), so the host list only
  // matters for a copy running without one.
  if (api && !password && !hostAllowed(host)) {
    return out(deny(`Unknown host "${host.slice(0, 100)}". Add it to ALLOWED_HOSTS (or set APP_PASSWORD) to serve the app under this name.`, 403));
  }

  // { request } passes refreshed cookies on to this request's pages and route handlers.
  if (!password || pathname === "/unlock") return out(NextResponse.next({ request: req }));
  const ok = await isValidSession(req.cookies.get(SESSION_COOKIE)?.value);
  const navigation = req.headers.get("sec-fetch-mode") === "navigate" || (req.method === "GET" && !!req.headers.get("accept")?.includes("text/html"));
  if (!ok) {
    // API calls and the service worker's precaching get a plain 401. A page load gets the password form right
    // here, not a redirect: Next turns a middleware redirect into an absolute "localhost" URL, and 127.0.0.1 and
    // localhost hold different data (IndexedDB is per address). Being a 401, it's never cached as the page.
    // /auth/* requests get it in the auth client's shape, so the screens read it as "blocked" (reload), never as an
    // unknown answer (which the email screens would have shown as "sent").
    if (!navigation && isAuthPath(pathname)) {
      const locked = authError(401, "blocked");
      return out(new NextResponse(locked.body, locked));
    }
    if (!navigation || api) return out(deny("This app is locked. Reload the page and enter the password.", 401));
    return out(unlockPage(safeNext(pathname + search), "", 401));
  }
  // Unlocked: now the session may be refreshed. (Before NextResponse.next, which takes the request's cookies as they are.)
  const applyUnlocked = await refreshSession(req);
  const res = NextResponse.next({ request: req });
  // Sliding expiry: a device in regular use stays signed in.
  if (navigation) {
    res.cookies.set(SESSION_COOKIE, req.cookies.get(SESSION_COOKIE)!.value, {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE,
      secure: req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https",
    });
  }
  return applyUnlocked(res);
}

export const config = {
  runtime: "nodejs",
  // Static files carry no data and must load before unlocking (the unlock page itself, icons, the service worker).
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|icon|apple-icon|manifest\\.webmanifest|sw\\.js|swe-worker|pdf\\.worker).*)"],
};
