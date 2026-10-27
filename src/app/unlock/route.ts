import { appPassword, passwordMatches, sessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/access";
import { safeNext, unlockPage } from "@/lib/unlock-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The password form for a deployed copy (APP_PASSWORD). Plain HTML from a route handler rather than a page, so
// none of the app's layout (Drive sync, the nav, the exam-mode prompt) runs before the visitor is let in.

const ATTEMPTS = 10; // wrong passwords allowed per address per window
const ATTEMPTS_ALL = 30; // and from everyone together, since an address can be faked where it isn't checked
const WINDOW_MS = 15 * 60_000;
const failures = new Map<string, { n: number; reset: number }>();
const EVERYONE = "*";

/**
 * Who's guessing. X-Forwarded-For is whatever the client sends unless a proxy we trust overwrites it, and Vercel's
 * does (x-real-ip is its own copy). Anywhere else every guess shares one bucket, so changing the header buys nothing.
 */
const clientKey = (req: Request) => (process.env.VERCEL && req.headers.get("x-real-ip")) || EVERYONE;

/** The bucket for `key`, started afresh once its window is over. */
function bucket(key: string, now: number) {
  let f = failures.get(key);
  if (!f || f.reset < now) {
    f = { n: 0, reset: now + WINDOW_MS };
    if (failures.size > 10_000) failures.clear(); // never grows without bound
    failures.set(key, f);
  }
  return f;
}

// Relative Location on purpose: Next reports req.url as "localhost" even for 127.0.0.1, and IndexedDB data is
// kept per address, so an absolute redirect could land the student in an empty copy of the app.
const redirect = (to: string, headers: Record<string, string> = {}) => new Response(null, { status: 303, headers: { Location: to, ...headers } });

export function GET(req: Request) {
  const next = safeNext(new URL(req.url).searchParams.get("next"));
  if (!appPassword()) return redirect(next);
  return unlockPage(next);
}

export async function POST(req: Request) {
  if (!appPassword()) return redirect("/");
  const form = await req.formData().catch(() => null);
  const next = safeNext(form?.get("next"));
  const given = form?.get("password");

  // Best effort (per server instance): enough to make guessing slow.
  const now = Date.now();
  const key = clientKey(req);
  const mine = bucket(key, now);
  const all = bucket(EVERYONE, now);
  if (mine.n >= ATTEMPTS || all.n >= ATTEMPTS_ALL) return unlockPage(next, "Too many wrong passwords. Try again in 15 minutes.", 429);
  // Counted before checking, synchronously: guesses sent all at once each see the ones ahead of them, so a
  // burst can't all pass the limit while the first is still being checked. A right password gives its try back.
  mine.n++;
  if (mine !== all) all.n++;

  if (typeof given !== "string" || given.length > 1000 || !(await passwordMatches(given))) {
    await new Promise((r) => setTimeout(r, 500));
    return unlockPage(next, "That password isn't right.", 401);
  }
  // Right password: this try doesn't count, and a known client's slate is wiped.
  all.n = Math.max(0, all.n - 1);
  if (key !== EVERYONE) failures.delete(key);

  const https = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  const cookie = [
    `${SESSION_COOKIE}=${await sessionToken(appPassword())}`,
    "Path=/", `Max-Age=${SESSION_MAX_AGE}`, "HttpOnly", "SameSite=Lax", ...(https ? ["Secure"] : []),
  ].join("; ");
  return redirect(next, { "Set-Cookie": cookie });
}
