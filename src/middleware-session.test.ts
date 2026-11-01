import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { middleware } from "./middleware";
import { resetAccountsConfigForTests } from "./lib/supabase/env";
import { refreshSession } from "./lib/supabase/middleware";
import { MemoryStore, setStoreForTests } from "./lib/ratelimit";
import { createServerClient } from "@supabase/ssr";
import { verifyUser } from "./lib/auth";
import { COOKIE, cookieHeader, fakeSupabase, sessionBody, signedInCookies, SUPABASE_URL, type Reply } from "./test/fake-supabase";

// The fake project is an approved development project here; the committed list is empty (src/lib/supabase/env.test.ts).
vi.mock("./lib/supabase/projects", () => ({ SUPABASE_PROJECTS: { development: ["devref"], production: [] } }));

// These run the REAL @supabase/ssr and @supabase/auth-js (cookie chunking, retries, error mapping) against a fake
// Supabase server reached through a stubbed fetch, so what's tested is what would happen in production.

const ACCOUNTS = {
  SUPABASE_URL: "https://devref.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_ENV: "development",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAAtest",
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
    const otherProject = cookieHeader(expiring.map((c) => ({ ...c, name: c.name.replace("devref", "otherref") })));
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

  it("checks the per-IP bucket, then the global one, before contacting Supabase", async () => {
    stub(ACCOUNTS);
    server.reply("refresh", { status: 200, body: sessionBody(3600) });
    const limit = vi.fn(allow.limit);
    setStoreForTests({ limit });
    await middleware(request("http://127.0.0.1:3000/subjects", { cookie: cookieHeader(await signedInCookies(30)) }));
    expect(limit.mock.calls).toEqual([
      ["session:ip", "local"],
      ["session:global", "all"],
    ]);
    expect(refreshCalls()).toHaveLength(1);
  });

  it("a per-IP refusal doesn't use up the global allowance", async () => {
    stub(ACCOUNTS);
    const store = new MemoryStore({});
    const limit = vi.spyOn(store, "limit");
    setStoreForTests(store);
    const cookie = cookieHeader(await signedInCookies(30));
    for (let i = 0; i < 15; i++) {
      server.reply("refresh", { status: 200, body: sessionBody(3600) });
      await middleware(request("http://127.0.0.1:3000/subjects", { cookie }));
    }
    const ip = limit.mock.calls.filter(([b]) => b === "session:ip").length;
    const global = limit.mock.calls.filter(([b]) => b === "session:global").length;
    expect(ip).toBe(15);
    expect(global).toBe(10); // only the 10 the per-IP limit let through
    expect(refreshCalls()).toHaveLength(10);
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

  it("rides on the APP_PASSWORD unlock page (401)", async () => {
    stub({ ...ACCOUNTS, APP_PASSWORD: "a long random password" });
    server.reply("refresh", { status: 200, body: sessionBody(3600) });
    const res = await middleware(request("http://127.0.0.1:3000/subjects", { cookie: cookieHeader(await signedInCookies(30)) }));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("text/html");
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

describe("the deadline (real timers, short deadline)", () => {
  const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("Supabase not answering: gives up at the deadline, writes nothing, and makes no call after it", async () => {
    stub(ACCOUNTS);
    server.reply("refresh", "hang");
    const req = request("http://127.0.0.1:3000/subjects", { cookie: cookieHeader(await signedInCookies(30)) });
    const started = Date.now();
    const apply = await refreshSession(req, { deadlineMs: 300 });
    const tookMs = Date.now() - started;
    expect(tookMs).toBeLessThan(1000);
    const res = apply(new (await import("next/server")).NextResponse(null));
    expect(setCookies(res)).toEqual([]);
    const deadlineAt = started + 300;
    await settle(1500); // auth-js would retry (200ms, 400ms, 800ms…) if its calls were allowed out
    expect(refreshCalls()).toHaveLength(1);
    expect(server.calls.every((c) => c.at <= deadlineAt + 50)).toBe(true);
  });

  it("Supabase failing with retryable errors (503): retries stop at the deadline instead of running ~30s", async () => {
    stub(ACCOUNTS);
    server.reply("refresh", { status: 503, body: {} }, { status: 503, body: {} }, { status: 503, body: {} }, { status: 503, body: {} }, { status: 200, body: sessionBody(3600) });
    const req = request("http://127.0.0.1:3000/subjects", { cookie: cookieHeader(await signedInCookies(30)) });
    const started = Date.now();
    const apply = await refreshSession(req, { deadlineMs: 500 });
    const res = apply(new (await import("next/server")).NextResponse(null));
    await settle(2000);
    expect(server.calls.every((c) => c.at <= started + 550)).toBe(true); // nothing went out after the deadline
    expect(refreshCalls().length).toBeLessThanOrEqual(3); // 0ms, ~200ms, ~600ms would be the 3rd: cut off
    expect(setCookies(res)).toEqual([]); // and a later success can't have been half-applied
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
