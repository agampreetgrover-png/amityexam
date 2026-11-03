import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { middleware } from "./middleware";
import { resetAccountsConfigForTests } from "./lib/supabase/env";
import { LIMIT_TIMEOUT_MS, MIN_REFRESH_MS, refreshSession } from "./lib/supabase/middleware";
import { MemoryStore, sessionKey, setStoreForTests } from "./lib/ratelimit";
import { resetJwksCacheForTests } from "./lib/supabase/token-proof";
import { createServerClient } from "@supabase/ssr";
import { verifyUser } from "./lib/auth";
import { SESSION_COOKIE, sessionToken } from "./lib/access";
import { COOKIE, cookieHeader, fakeSupabase, sessionBody, signedInCookies, SUPABASE_URL, type Reply } from "./test/fake-supabase";

// The fake project is an approved development project here; the committed list is empty (src/lib/supabase/env.test.ts).
vi.mock("./lib/supabase/projects", () => ({ SUPABASE_PROJECTS: { development: ["devrefaaaaaaaaaaaaaa"], production: [], local: [] } }));

// These run the REAL @supabase/ssr and @supabase/auth-js (cookie chunking, retries, error mapping) against a fake
// Supabase server reached through a stubbed fetch, so what's tested is what would happen in production.

const ACCOUNTS = {
  SUPABASE_URL: "https://devrefaaaaaaaaaaaaaa.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_ENV: "development",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAAtest",
  TURNSTILE_SECRET_KEY: "0x4AAAAAAAtest-secret",
};
const VERCEL_PREVIEW = { ...ACCOUNTS, VERCEL: "1", VERCEL_ENV: "preview", UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t", RATE_LIMIT_SECRET: "s".repeat(32) };
const stub = (env: Record<string, string>) => Object.entries(env).forEach(([k, v]) => vi.stubEnv(k, v));

let server: ReturnType<typeof fakeSupabase>;
const allow = { limit: async () => ({ success: true, reset: 0 }) };

/** A page load (or, with page: false, a data request) carrying these cookies. */
const request = (url: string, { cookie, method = "GET", page = true }: { cookie?: string; method?: string; page?: boolean } = {}) => {
  const headers: Record<string, string> = { host: new URL(url).host, "sec-fetch-site": "same-origin" };
  if (page) headers["sec-fetch-mode"] = "navigate";
  if (cookie) headers.cookie = cookie;
  return new NextRequest(url, { method, headers });
};
const refreshCalls = () => server.calls.filter((c) => c.endpoint === "refresh");
const setCookies = (res: Response) => res.headers.getSetCookie();

beforeEach(() => {
  server = fakeSupabase();
  vi.stubGlobal("fetch", server.fetch);
  resetAccountsConfigForTests();
  resetJwksCacheForTests();
  setStoreForTests(allow);
  for (const k of [...Object.keys(VERCEL_PREVIEW), "APP_PASSWORD"]) vi.stubEnv(k, "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetAccountsConfigForTests();
  setStoreForTests(undefined);
});

describe("when Supabase is contacted", () => {
  it("never while accounts are off, even with an expiring session", async () => {
    const res = await middleware(request("http://127.0.0.1:3000/subjects", { cookie: cookieHeader(await signedInCookies(30)) }));
    expect(server.calls).toHaveLength(0);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("never for made-up cookies, another project's cookie, or no cookie, and the limiter isn't even asked", async () => {
    stub(ACCOUNTS);
    const limit = vi.fn(allow.limit);
    setStoreForTests({ limit });
    const expiring = await signedInCookies(30);
    const otherProject = cookieHeader(expiring.map((c) => ({ ...c, name: c.name.replace("devrefaaaaaaaaaaaaaa", "otherrefaaaaaaaaaaaa") })));
    for (const cookie of [undefined, "theme=dark", `${COOKIE}=x`, `${COOKIE}.0=aaa`, otherProject]) {
      const res = await middleware(request("http://127.0.0.1:3000/subjects", { cookie }));
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
    expect(server.calls).toHaveLength(0);
    expect(limit).not.toHaveBeenCalled();
  });

  it("never for a session that isn't about to expire", async () => {
    stub(ACCOUNTS);
    await middleware(request("http://127.0.0.1:3000/subjects", { cookie: cookieHeader(await signedInCookies(3600)) }));
    expect(server.calls).toHaveLength(0);
  });

  it("only on page loads: prefetch, data and API requests leave the refresh to the next page load or the route", async () => {
    stub(ACCOUNTS);
    const cookie = cookieHeader(await signedInCookies(30));
    await middleware(request("http://127.0.0.1:3000/subjects", { cookie, page: false }));
    await middleware(request("http://127.0.0.1:3000/api/ai/chat", { cookie, method: "POST", page: false }));
    expect(server.calls).toHaveLength(0);
  });

  it("checks the per-IP bucket, then the session, then the global one, before contacting Supabase", async () => {
    stub(ACCOUNTS);
    server.reply("refresh", { status: 200, body: sessionBody(3600) });
    const limit = vi.fn(allow.limit);
    setStoreForTests({ limit });
    await middleware(request("http://127.0.0.1:3000/subjects", { cookie: cookieHeader(await signedInCookies(30)) }));
    expect(limit.mock.calls).toEqual([
      ["session:ip", "local"],
      ["session:sid", sessionKey("s1")], // the session id from the verified access token, hashed
      ["session:global", "all"],
    ]);
    expect(refreshCalls()).toHaveLength(1);
  });

  it("a per-IP or per-session refusal doesn't use up the global allowance", async () => {
    stub(ACCOUNTS);
    const store = new MemoryStore({});
    const limit = vi.spyOn(store, "limit");
    setStoreForTests(store);
    const cookie = cookieHeader(await signedInCookies(30));
    for (let i = 0; i < 15; i++) {
      server.reply("refresh", { status: 200, body: sessionBody(3600) });
      await middleware(request("http://127.0.0.1:3000/subjects", { cookie }));
    }
    const count = (bucket: string) => limit.mock.calls.filter(([b]) => b === bucket).length;
    expect(count("session:ip")).toBe(15);
    expect(count("session:sid")).toBe(10); // only the 10 the per-IP limit let through
    expect(count("session:global")).toBe(4); // only the 4 this one session may use per window
    expect(refreshCalls()).toHaveLength(4);
  });

  it("not when the rate-limit store can't answer (fails closed); the page still renders", async () => {
    stub(ACCOUNTS);
    setStoreForTests({ limit: async () => Promise.reject(new Error("ECONNRESET")) });
    const res = await middleware(request("http://127.0.0.1:3000/subjects", { cookie: cookieHeader(await signedInCookies(30)) }));
    expect(server.calls).toHaveLength(0);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("what reaches the browser", () => {
  it("a refreshed session: HttpOnly, SameSite=Lax, Path=/, no-cache headers, and passed on to this request", async () => {
    stub(ACCOUNTS);
    server.reply("refresh", { status: 200, body: sessionBody(3600) });
    const res = await middleware(request("http://127.0.0.1:3000/subjects", { cookie: cookieHeader(await signedInCookies(30)) }));
    const cookies = setCookies(res);
    expect(cookies.some((c) => c.startsWith(`${COOKIE}=base64-`))).toBe(true);
    for (const c of cookies) {
      expect(c).toMatch(/HttpOnly/i);
      expect(c).toMatch(/SameSite=lax/i);
      expect(c).toMatch(/Path=\//);
      expect(c).not.toMatch(/;\s*Secure/i); // plain http: the browser would drop a Secure cookie
    }
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-middleware-request-cookie") ?? "").toContain(`${COOKIE}=base64-`);
  });

  it("a rotation that changes the cookie's chunks (one cookie → .0/.1) is kept whole, deletion of the old one included", async () => {
    stub(ACCOUNTS);
    const before = await signedInCookies(30);
    expect(before.map((c) => c.name)).toEqual([COOKIE]);
    server.reply("refresh", { status: 200, body: sessionBody(3600, "x".repeat(6000)) });
    const res = await middleware(request("http://127.0.0.1:3000/subjects", { cookie: cookieHeader(before) }));
    const cookies = setCookies(res);
    expect(cookies.some((c) => c.startsWith(`${COOKIE}.0=`))).toBe(true);
    expect(cookies.some((c) => c.startsWith(`${COOKIE}.1=`))).toBe(true);
    expect(cookies.some((c) => new RegExp(`^${COOKIE}=;.*Max-Age=0`, "i").test(c))).toBe(true);
  });

  it("is Secure over https", async () => {
    stub(VERCEL_PREVIEW);
    server.reply("refresh", { status: 200, body: sessionBody(3600) });
    const res = await middleware(request("https://dev.example.app/subjects", { cookie: cookieHeader(await signedInCookies(30)) }));
    expect(setCookies(res).every((c) => /;\s*Secure/i.test(c))).toBe(true);
  });

  it("rides on the existing 503 for /api on Vercel without APP_PASSWORD", async () => {
    stub(VERCEL_PREVIEW);
    server.reply("refresh", { status: 200, body: sessionBody(3600) });
    const req = new NextRequest("https://dev.example.app/api/ai/chat", {
      method: "GET",
      headers: { host: "dev.example.app", "sec-fetch-site": "same-origin", accept: "text/html", cookie: cookieHeader(await signedInCookies(30)) },
    });
    const res = await middleware(req);
    expect(res.status).toBe(503);
    expect(setCookies(res).some((c) => c.startsWith(`${COOKIE}=base64-`))).toBe(true);
  });

  it("with APP_PASSWORD set, a locked visitor gets the unlock page and causes NO call to Supabase", async () => {
    stub({ ...ACCOUNTS, APP_PASSWORD: "a long random password" });
    const limit = vi.fn(allow.limit);
    setStoreForTests({ limit });
    server.reply("refresh", { status: 200, body: sessionBody(3600) });
    const res = await middleware(request("http://127.0.0.1:3000/subjects", { cookie: cookieHeader(await signedInCookies(30)) }));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(server.calls).toHaveLength(0);
    expect(limit).not.toHaveBeenCalled(); // not even the refresh limits are spent
    expect(setCookies(res)).toEqual([]);
  });

  it("with APP_PASSWORD set, an unlocked visitor's expiring session is refreshed", async () => {
    stub({ ...ACCOUNTS, APP_PASSWORD: "a long random password" });
    server.reply("refresh", { status: 200, body: sessionBody(3600) });
    const unlocked = `${SESSION_COOKIE}=${await sessionToken("a long random password")}`;
    const old = await signedInCookies(30);
    const oldValue = old.find((c) => c.name === COOKIE)!.value;
    const res = await middleware(request("http://127.0.0.1:3000/subjects", { cookie: `${unlocked}; ${cookieHeader(old)}` }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(refreshCalls()).toHaveLength(1);
    // The new session cookie, as sent to the browser…
    const newValue = setCookies(res)
      .find((c) => c.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1)
      .split(";")[0];
    expect(newValue).toMatch(/^base64-/);
    expect(newValue).not.toBe(oldValue);
    // …is what this request's pages and route handlers now see, in place of the old one (both values are long and
    // distinct, so neither can match the other by accident).
    const forwarded = res.headers.get("x-middleware-request-cookie") ?? "";
    expect(forwarded).toContain(`${COOKIE}=${newValue}`);
    expect(forwarded).not.toContain(oldValue);
    expect(forwarded).toContain(unlocked); // the unlock cookie is passed on unchanged
  });

  it("/token answering 200 without a session: auth-js wipes it, but that is NOT passed on; the cookies stay", async () => {
    stub(ACCOUNTS);
    server.reply("refresh", { status: 200, body: {} });
    const res = await middleware(request("http://127.0.0.1:3000/subjects", { cookie: cookieHeader(await signedInCookies(-10)) }));
    expect(refreshCalls()).toHaveLength(1);
    expect(setCookies(res)).toEqual([]);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("a page load the service worker sends with navigation preload is refreshed like any page load", async () => {
    stub(ACCOUNTS);
    server.reply("refresh", { status: 200, body: sessionBody(3600) });
    const req = new NextRequest("http://127.0.0.1:3000/subjects", {
      headers: {
        host: "127.0.0.1:3000",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
        "service-worker-navigation-preload": "true",
        cookie: cookieHeader(await signedInCookies(30)),
      },
    });
    const res = await middleware(req);
    expect(refreshCalls()).toHaveLength(1);
    expect(setCookies(res).some((c) => c.startsWith(`${COOKIE}=base64-`))).toBe(true);
  });

  for (const [why, reply] of [
    ["rate limited (429)", { status: 429, body: { code: "over_request_rate_limit", msg: "slow down" } }],
    ["timed out (408)", { status: 408, body: { code: "request_timeout", msg: "timeout" } }],
  ] as const) {
    it(`Supabase ${why}: auth-js wipes the expired session, but that is NOT passed on; the cookies stay`, async () => {
      stub(ACCOUNTS);
      server.reply("refresh", reply);
      const res = await middleware(request("http://127.0.0.1:3000/subjects", { cookie: cookieHeader(await signedInCookies(-10)) }));
      expect(refreshCalls()).toHaveLength(1);
      expect(setCookies(res)).toEqual([]);
      expect(res.headers.get("x-middleware-next")).toBe("1");
    });
  }

  for (const [why, reply] of [
    ["refresh_token_not_found", { status: 400, body: { code: "refresh_token_not_found", msg: "Invalid Refresh Token" } }],
    ["refresh_token_already_used", { status: 400, body: { code: "refresh_token_already_used", msg: "Already Used" } }],
    ["session_not_found (revoked; auth-js reports it as AuthSessionMissingError)", { status: 403, body: { code: "session_not_found", msg: "Session not found" } }],
  ] as const) {
    it(`the session definitely gone (${why}): the cookies are removed`, async () => {
      stub(ACCOUNTS);
      server.reply("refresh", reply);
      const res = await middleware(request("http://127.0.0.1:3000/subjects", { cookie: cookieHeader(await signedInCookies(-10)) }));
      expect(setCookies(res).some((c) => new RegExp(`^${COOKIE}=;.*Max-Age=0`, "i").test(c))).toBe(true);
    });
  }

  it("leaves /auth/* outside the /api 503 on Vercel without APP_PASSWORD", async () => {
    stub({ VERCEL: "1" });
    const res = await middleware(request("https://dev.example.app/auth/session"));
    expect(res.status).not.toBe(503);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("the deadline (real timers)", () => {
  const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // A deadline long enough that a refresh is started (more than MIN_REFRESH_MS left after the limit check).
  const DEADLINE = 1500;

  it("Supabase not answering: gives up at the deadline, writes nothing, and makes no call after it", async () => {
    stub(ACCOUNTS);
    server.reply("refresh", "hang");
    const req = request("http://127.0.0.1:3000/subjects", { cookie: cookieHeader(await signedInCookies(30)) });
    const started = Date.now();
    const apply = await refreshSession(req, { deadlineMs: DEADLINE });
    const tookMs = Date.now() - started;
    expect(tookMs).toBeGreaterThanOrEqual(DEADLINE - 50); // it really waited for Supabase…
    expect(tookMs).toBeLessThan(DEADLINE + 500); // …and no longer than the deadline
    const res = apply(new (await import("next/server")).NextResponse(null));
    expect(setCookies(res)).toEqual([]);
    await settle(2000); // auth-js would retry (200ms, 400ms, 800ms…) if its calls were allowed out
    expect(refreshCalls()).toHaveLength(1);
    expect(server.calls.every((c) => c.at <= started + DEADLINE + 50)).toBe(true);
  });

  it("Supabase failing with retryable errors (503): retries stop at the deadline instead of running ~30s", async () => {
    stub(ACCOUNTS);
    server.reply("refresh", ...Array.from({ length: 8 }, () => ({ status: 503, body: {} })), { status: 200, body: sessionBody(3600) });
    const req = request("http://127.0.0.1:3000/subjects", { cookie: cookieHeader(await signedInCookies(30)) });
    const started = Date.now();
    const apply = await refreshSession(req, { deadlineMs: DEADLINE });
    const res = apply(new (await import("next/server")).NextResponse(null));
    await settle(3000);
    expect(server.calls.every((c) => c.at <= started + DEADLINE + 50)).toBe(true); // nothing went out after the deadline
    // The refresh really ran and retried (it would pass vacuously if it never started), but was cut off: attempts at
    // ~0, ~200, ~600 and ~1400ms; the next (~3000ms) falls after the deadline.
    expect(refreshCalls().length).toBeGreaterThanOrEqual(2);
    expect(refreshCalls().length).toBeLessThanOrEqual(4);
    expect(setCookies(res)).toEqual([]); // and a later success can't have been half-applied
  });
});

// The two ways the rate-limit step can stop a refresh, told apart. Each test fails if its own guard is removed.
describe("stopping at the rate-limit step", () => {
  const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /**
   * A store that allows everything, answering the FIRST bucket (session:ip) after `ms` and the second at once, so the
   * whole check takes about `ms` (the buckets are checked one after the other). Records the buckets it answered.
   */
  const slowStore = (ms: number) => {
    const answered: string[] = [];
    return {
      answered,
      store: {
        limit: (bucket: string) =>
          new Promise<{ success: boolean; reset: number }>((r) =>
            setTimeout(() => (answered.push(bucket), r({ success: true, reset: 0 })), bucket === "session:ip" ? ms : 0),
          ),
      },
    };
  };

  it("path 1, the limits can't answer in time (LIMIT_TIMEOUT_MS): stops when the limit check gives up, no call to Supabase", async () => {
    stub(ACCOUNTS);
    server.reply("refresh", { status: 200, body: sessionBody(3600) });
    const { store, answered } = slowStore(LIMIT_TIMEOUT_MS + 400); // well inside the 3s deadline, but past the limit timeout
    setStoreForTests(store);
    const req = request("http://127.0.0.1:3000/subjects", { cookie: cookieHeader(await signedInCookies(30)) });
    const started = Date.now();
    const apply = await refreshSession(req); // the real 3000ms deadline
    const tookMs = Date.now() - started;
    expect(tookMs).toBeGreaterThanOrEqual(LIMIT_TIMEOUT_MS - 50);
    expect(tookMs).toBeLessThan(LIMIT_TIMEOUT_MS + 300); // it gave up at the limit timeout, not when the store answered
    expect(answered).toEqual([]); // the store hadn't answered yet: this is the "couldn't answer" path
    await settle(600);
    expect(server.calls).toHaveLength(0);
    expect(setCookies(apply(new (await import("next/server")).NextResponse(null)))).toEqual([]);
  });

  it("path 2, the limits allow it but too little of the deadline is left (MIN_REFRESH_MS): no call to Supabase", async () => {
    stub(ACCOUNTS);
    server.reply("refresh", { status: 200, body: sessionBody(3600) });
    const { store, answered } = slowStore(800); // answers within LIMIT_TIMEOUT_MS…
    setStoreForTests(store);
    const req = request("http://127.0.0.1:3000/subjects", { cookie: cookieHeader(await signedInCookies(30)) });
    const apply = await refreshSession(req, { deadlineMs: 1500 }); // …leaving ~700ms, less than MIN_REFRESH_MS
    expect(answered).toEqual(["session:ip", "session:sid", "session:global"]); // every limit said yes: the "too little time left" path
    await settle(1200); // past the deadline: a refresh started at ~800ms would have reached Supabase by now
    expect(server.calls).toHaveLength(0);
    expect(setCookies(apply(new (await import("next/server")).NextResponse(null)))).toEqual([]);
  });

  it("control: the limits allow it with enough time left: the refresh goes ahead", async () => {
    stub(ACCOUNTS);
    server.reply("refresh", { status: 200, body: sessionBody(3600) });
    const { store } = slowStore(300);
    setStoreForTests(store);
    const req = request("http://127.0.0.1:3000/subjects", { cookie: cookieHeader(await signedInCookies(30)) });
    const apply = await refreshSession(req, { deadlineMs: 1500 + MIN_REFRESH_MS });
    expect(refreshCalls()).toHaveLength(1);
    expect(setCookies(apply(new (await import("next/server")).NextResponse(null))).some((c) => c.startsWith(`${COOKIE}=base64-`))).toBe(true);
  });
});

// The global (or per-IP) session limit running out may only ever mean "no refresh this time": no request to Supabase,
// no cookie written or cleared, nobody let in. Whether a session is valid is decided later, by getUser() in a route.
describe("an exhausted refresh limit grants nothing", () => {
  const globalExhausted = { limit: async (bucket: string) => ({ success: bucket !== "session:global", reset: Date.now() + 60_000 }) };
  const ipExhausted = { limit: async (bucket: string) => ({ success: bucket !== "session:ip", reset: Date.now() + 60_000 }) };

  for (const [which, store] of [
    ["global", globalExhausted],
    ["per-IP", ipExhausted],
  ] as const) {
    it(`${which} limit exhausted: no Supabase call, no cookie written or cleared, the request goes on with its own cookies`, async () => {
      stub(ACCOUNTS);
      setStoreForTests(store);
      const cookie = cookieHeader(await signedInCookies(-10));
      const res = await middleware(request("http://127.0.0.1:3000/subjects", { cookie }));
      expect(server.calls).toHaveLength(0);
      expect(setCookies(res)).toEqual([]);
      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-next")).toBe("1");
      expect(res.headers.get("x-middleware-request-cookie")).toBe(cookie); // untouched, not upgraded or replaced
    });
  }

  it("the expired session it skipped is still not a signed-in user: getUser() refreshes or refuses on its own", async () => {
    stub(ACCOUNTS);
    setStoreForTests(globalExhausted);
    const expired = await signedInCookies(-10);
    await middleware(request("http://127.0.0.1:3000/subjects", { cookie: cookieHeader(expired) }));
    expect(server.calls).toHaveLength(0);

    // What a route handler (S1) would then see, through the real @supabase/ssr and auth-js:
    const verifyWith = async (refresh: Reply) => {
      const s = fakeSupabase();
      s.reply("refresh", refresh);
      const supabase = createServerClient(SUPABASE_URL, "sb_publishable_test", {
        cookies: { getAll: () => expired, setAll: () => {} },
        global: { fetch: s.fetch },
      });
      return { result: await verifyUser(supabase), userCalls: s.calls.filter((c) => c.endpoint === "user").length };
    };
    // Supabase also rate limiting: unknown, so refused (never "ok", and never the old token sent to /user).
    const limited = await verifyWith({ status: 429, body: { code: "over_request_rate_limit", msg: "slow down" } });
    expect(limited.result).toEqual({ status: "unavailable" });
    expect(limited.userCalls).toBe(0);
    // Revoked or already-used refresh token: signed out.
    for (const code of ["refresh_token_not_found", "refresh_token_already_used"]) {
      const gone = await verifyWith({ status: 400, body: { code, msg: "invalid" } });
      expect(gone.result).toMatchObject({ status: "signed-out" });
    }
    const revoked = await verifyWith({ status: 403, body: { code: "session_not_found", msg: "Session not found" } });
    expect(revoked.result).toMatchObject({ status: "signed-out" });
  });

  it("a rate-limit skip and a dead session look different: only Supabase saying the session is gone clears cookies", async () => {
    stub(ACCOUNTS);
    const cookie = cookieHeader(await signedInCookies(-10));
    setStoreForTests(globalExhausted);
    const skipped = await middleware(request("http://127.0.0.1:3000/subjects", { cookie }));
    setStoreForTests(allow);
    server.reply("refresh", { status: 400, body: { code: "refresh_token_not_found", msg: "Invalid Refresh Token" } });
    const dead = await middleware(request("http://127.0.0.1:3000/subjects", { cookie }));
    expect(setCookies(skipped)).toEqual([]);
    expect(setCookies(dead).some((c) => new RegExp(`^${COOKIE}=;.*Max-Age=0`, "i").test(c))).toBe(true);
  });
});
