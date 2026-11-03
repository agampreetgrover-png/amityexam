import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { middleware } from "@/middleware";
import { LIMITS, setStoreForTests, type Bucket } from "@/lib/ratelimit";
import { COOKIE, accessToken, cookieHeader, forgedAccessToken, hs256AccessToken, sessionBody, signedInCookies, USER_ID } from "@/test/fake-supabase";
import { get, isDeletion, post, sessionIn, setCookies, setupAccounts, teardownAccounts, type Harness } from "@/test/auth-routes";
import { GET as session } from "./session/route";
import { POST as signout } from "./signout/route";
import { POST as updatePassword } from "./update-password/route";

vi.mock("@/lib/supabase/projects", () => ({ SUPABASE_PROJECTS: { development: ["devrefaaaaaaaaaaaaaa"], production: [], local: [] } }));

// M1: made-up cookies must not use up the refresh budget every student shares.
// M2: a made-up cookie with a far-future expires_at must not reach Supabase's /user without limit.
// The access token in the cookie is checked against the project's published signing key first (token-proof.ts):
// forged ones never reach a limit or Supabase; ones that can't be checked (HS256) get a small budget of their own;
// only verified sessions use the main buckets.

const USER = { id: USER_ID, aud: "authenticated", email: "a@example.test", email_confirmed_at: "2026-11-01T00:00:00Z" };
const now = () => Math.floor(Date.now() / 1000);
const b64 = (o: unknown) => "base64-" + Buffer.from(JSON.stringify(o)).toString("base64url");
/** A session cookie written by hand (as an attacker would), around a given access token. */
const cookieWith = (access_token: string, expires_at: unknown) => [
  { name: COOKIE, value: b64({ access_token, refresh_token: "made-up", token_type: "bearer", expires_at, expires_in: 3600, user: { id: USER_ID } }) },
];

/** Counts like the real limiter, per bucket and key. */
function countingStore() {
  const hits = new Map<string, number>();
  const checks: { bucket: Bucket; key: string }[] = [];
  const refuse = new Set<Bucket>();
  return {
    checks,
    refuse,
    count: (bucket: Bucket) => checks.filter((c) => c.bucket === bucket).length,
    limit: async (bucket: Bucket, key: string) => {
      checks.push({ bucket, key });
      const n = (hits.get(`${bucket}:${key}`) ?? 0) + 1;
      hits.set(`${bucket}:${key}`, n);
      return { success: !refuse.has(bucket) && n <= LIMITS[bucket].limit, reset: Date.now() + 60_000 };
    },
  };
}

let h: Harness;
let store: ReturnType<typeof countingStore>;
beforeEach(() => {
  h = setupAccounts();
  store = countingStore();
  setStoreForTests(store);
});
afterEach(teardownAccounts);

const pageLoad = (cookies: { name: string; value: string }[], ip = "1") =>
  new NextRequest("http://127.0.0.1:3000/subjects", {
    headers: { host: "127.0.0.1:3000", "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate", cookie: cookieHeader(cookies), "x-test-ip": ip },
  });

describe("M1: forged cookies can't use up the shared refresh budget", () => {
  it("middleware: 200 page loads with forged, expiring cookies → no limit asked, no refresh, the global budget untouched", async () => {
    for (let i = 0; i < 200; i++) {
      const res = await middleware(pageLoad(cookieWith(forgedAccessToken(now() - 10, { session_id: `s${i}` }), now() - 10)));
      expect(res.headers.get("x-middleware-next")).toBe("1");
    }
    expect(store.checks).toHaveLength(0);
    expect(h.server.calls).toHaveLength(0);
    expect(h.server.jwksCalls.length).toBeLessThanOrEqual(1); // the keys, fetched once
  });

  it("a forged token that isn't even a token (junk, alg none) is treated the same, without fetching keys", async () => {
    for (const t of ["x.y.z", "not-a-jwt", `${Buffer.from('{"alg":"none"}').toString("base64url")}.e30.`]) {
      await middleware(pageLoad(cookieWith(t, now() - 10)));
    }
    expect(store.checks).toHaveLength(0);
    expect(h.server.calls).toHaveLength(0);
    expect(h.server.jwksCalls).toHaveLength(0);
  });

  it("genuine sessions still refresh, through the main budget, even while forged traffic is going on", async () => {
    for (let i = 0; i < 50; i++) await middleware(pageLoad(cookieWith(forgedAccessToken(now() - 10), now() - 10)));
    const fresh = sessionBody(3600);
    h.server.reply("refresh", { status: 200, body: fresh });
    const res = await middleware(pageLoad(await signedInCookies(30)));
    expect(h.server.calls.map((c) => c.endpoint)).toEqual(["refresh"]);
    expect(res.headers.getSetCookie().join("\n")).toContain(COOKIE);
    expect(store.checks.map((c) => c.bucket)).toEqual(["session:ip", "session:sid", "session:global"]);
  });

  it("tokens that can't be checked (HS256) use their own small budget and never touch the main one", async () => {
    for (let i = 0; i < 5; i++) {
      h.server.reply("refresh", { status: 400, body: { code: "refresh_token_not_found" } });
      await middleware(pageLoad(cookieWith(hs256AccessToken(now() - 10), now() - 10)));
    }
    expect(store.checks.map((c) => c.bucket).filter((b) => b !== "session:ip")).toEqual(Array(5).fill("session:unverified"));
    expect(store.count("session:global")).toBe(0);
  });

  it("with the unverified budget used up: those cookies reach nothing, and a genuine session still refreshes", async () => {
    store.refuse.add("session:unverified");
    await middleware(pageLoad(cookieWith(hs256AccessToken(now() - 10), now() - 10)));
    expect(h.server.calls).toHaveLength(0);
    h.server.reply("refresh", { status: 200, body: sessionBody(3600) });
    await middleware(pageLoad(await signedInCookies(30)));
    expect(h.server.calls.map((c) => c.endpoint)).toEqual(["refresh"]);
  });

  it("/auth/session with a forged, expiring cookie → signed out and its cookies deleted, without asking Supabase or spending a limit", async () => {
    const res = await session(get("/auth/session", { cookies: cookieWith(forgedAccessToken(now() - 10), now() - 10) }));
    expect(await res.json()).toEqual({ state: "signed-out", reason: "none" });
    expect(isDeletion(setCookies(res).get(COOKIE))).toBe(true);
    expect(store.checks).toHaveLength(0);
    expect(h.server.calls).toHaveLength(0);
  });

  it("a genuine expiring session through /auth/session: refreshed within the main buckets and written back", async () => {
    const fresh = sessionBody(3600);
    h.server.reply("refresh", { status: 200, body: fresh });
    h.server.reply("user", { status: 200, body: USER });
    const res = await session(get("/auth/session", { cookies: await signedInCookies(-10) }));
    expect(await res.json()).toMatchObject({ state: "verified" });
    expect((await sessionIn(res))?.refresh_token).toBe(fresh.refresh_token);
    expect(store.checks.map((c) => c.bucket)).toEqual(["session:ip", "session:sid", "session:global"]);
  });

  it("one genuine session replayed over and over is held to its per-session share", async () => {
    const cookies = await signedInCookies(-10);
    for (let i = 0; i < 10; i++) {
      h.server.reply("refresh", { status: 400, body: { code: "refresh_token_already_used" } });
      await session(get("/auth/session", { cookies }));
    }
    expect(h.server.calls.filter((c) => c.endpoint === "refresh")).toHaveLength(LIMITS["session:sid"].limit);
    expect(store.count("session:global")).toBe(LIMITS["session:sid"].limit);
  });
});

describe("M2: far-future cookies can't reach /user without limit", () => {
  const farFuture = now() + 10 * 365 * 86400;

  it("a forged far-future cookie → rejected before any /user call, every time, with no budget spent", async () => {
    for (let i = 0; i < 100; i++) {
      const res = await session(get("/auth/session", { cookies: cookieWith(forgedAccessToken(farFuture), farFuture) }));
      expect((await res.json()).state).toBe("signed-out");
    }
    expect(h.server.calls).toHaveLength(0);
    expect(store.checks).toHaveLength(0);
  });

  it("an unverifiable far-future cookie (HS256) is rate-limited before /user: per IP, then a small shared budget", async () => {
    const perIp = LIMITS["session-check:ip"].limit;
    for (let i = 0; i < perIp + 15; i++) {
      h.server.reply("user", { status: 403, body: { code: "bad_jwt" } });
      await session(get("/auth/session", { cookies: cookieWith(hs256AccessToken(farFuture), farFuture) }));
    }
    expect(h.server.calls.filter((c) => c.endpoint === "user")).toHaveLength(perIp);
    expect(store.checks.every((c) => c.bucket === "session-check:ip" || c.bucket === "session-check:unverified")).toBe(true);
  });

  it("with the unverified budget refused: unavailable, /user never asked", async () => {
    store.refuse.add("session-check:unverified");
    const res = await session(get("/auth/session", { cookies: cookieWith(hs256AccessToken(farFuture), farFuture) }));
    expect(await res.json()).toEqual({ state: "unavailable" });
    expect(h.server.calls).toHaveLength(0);
  });

  it("a genuine fresh session is checked within its per-session limit; past it, unavailable without asking /user", async () => {
    const cookies = await signedInCookies(3600);
    const cap = LIMITS["session-check:sid"].limit;
    for (let i = 0; i < cap + 5; i++) {
      h.server.reply("user", { status: 200, body: USER });
      await session(get("/auth/session", { cookies }));
    }
    expect(h.server.calls.filter((c) => c.endpoint === "user")).toHaveLength(cap);
    const last = await session(get("/auth/session", { cookies }));
    expect(await last.json()).toEqual({ state: "unavailable" });
  });

  it("the same applies to sign-out and password changes (each one a call to Supabase)", async () => {
    const forged = cookieWith(forgedAccessToken(farFuture), farFuture);
    const out = await signout(post("/auth/signout", {}, { cookies: forged }));
    expect(out.status).toBe(200);
    expect(isDeletion(setCookies(out).get(COOKIE))).toBe(true); // signing out still always works here
    const change = await updatePassword(post("/auth/update-password", { password: "a brand new passphrase", expectedUserId: USER_ID }, { cookies: forged }));
    expect(change.status).toBe(401);
    expect(h.server.calls).toHaveLength(0);
  });

  it("a genuine token under a far-future expires_at it doesn't have still goes through its session's limit", async () => {
    // A real but expired access token whose cookie claims it lasts for years: auth-js would send it to /user.
    const cookies = cookieWith(accessToken(now() - 3600), farFuture);
    h.server.reply("user", { status: 403, body: { code: "bad_jwt" } });
    await session(get("/auth/session", { cookies }));
    expect(store.checks.map((c) => c.bucket)).toEqual(["session-check:sid"]);
  });
});
