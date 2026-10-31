import { NextResponse, type NextRequest } from "next/server";
import { appPassword, isValidSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/access";
import { safeNext, unlockPage } from "@/lib/unlock-page";

// Guards the API routes, which spend the AI keys:
// 1. Other websites can't call them. Without this, any page open in the same browser could POST to
//    http://127.0.0.1:3000/api/ai/… (a "simple" text/plain request needs no CORS preflight) and use up the quota.
// 2. Only known host names are served (stops DNS rebinding, where evil.example is pointed at 127.0.0.1).
// 3. With APP_PASSWORD set (for a deployed copy), the whole app asks for the password once per device.

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
  // A password or a Vercel deployment already rules out rebinding (the attacker has no session cookie / can't
  // point Vercel's hostnames at a laptop), so the host list only matters for a copy running without either.
  if (api && !password && !process.env.VERCEL && !hostAllowed(host)) {
    return deny(`Unknown host "${host.slice(0, 100)}". Add it to ALLOWED_HOSTS (or set APP_PASSWORD) to serve the app under this name.`, 403);
  }

  if (!password || pathname === "/unlock") return NextResponse.next();
  const ok = await isValidSession(req.cookies.get(SESSION_COOKIE)?.value);
  const navigation = req.headers.get("sec-fetch-mode") === "navigate" || (req.method === "GET" && !!req.headers.get("accept")?.includes("text/html"));
  if (!ok) {
    // API calls and the service worker's precaching get a plain 401. A page load gets the password form right
    // here, not a redirect: Next turns a middleware redirect into an absolute "localhost" URL, and 127.0.0.1 and
    // localhost hold different data (IndexedDB is per address). Being a 401, it's never cached as the page.
    if (!navigation || api) return deny("This app is locked. Reload the page and enter the password.", 401);
    return unlockPage(safeNext(pathname + search), "", 401);
  }
  const res = NextResponse.next();
  // Sliding expiry: a device in regular use stays signed in.
  if (navigation) {
    res.cookies.set(SESSION_COOKIE, req.cookies.get(SESSION_COOKIE)!.value, {
      httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE,
      secure: req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https",
    });
  }
  return res;
}

export const config = {
  runtime: "nodejs",
  // Static files carry no data and must load before unlocking (the unlock page itself, icons, the service worker).
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|icon|apple-icon|manifest\\.webmanifest|sw\\.js|swe-worker|pdf\\.worker).*)"],
};
