import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/lib/access";
import { issueRecoveryMarker, RECOVERY_COOKIE } from "@/lib/auth/recovery-marker";
import { setStoreForTests } from "@/lib/ratelimit";
import { COOKIE, hs256AccessToken, sessionBody, signedInCookies, USER_ID, type Reply } from "@/test/fake-supabase";
import { get, isDeletion, post, sessionIn, setCookies, setupAccounts, teardownAccounts, type Harness } from "@/test/auth-routes";
import { GET as session } from "./session/route";
import { POST as signout } from "./signout/route";
import { POST as updatePassword } from "./update-password/route";

vi.mock("@/lib/supabase/projects", () => ({ SUPABASE_PROJECTS: { development: ["devrefaaaaaaaaaaaaaa"], production: [], local: [] } }));

// The routes that work on the session the browser already holds: GET /auth/session, POST /auth/signout and
// POST /auth/update-password. Real @supabase/ssr + auth-js against the fake Supabase server.

const USER = { id: USER_ID, aud: "authenticated", email: "a@example.test", email_confirmed_at: "2026-11-01T00:00:00Z" };
const err = (status: number, code: string): Reply => ({ status, body: { code, msg: code } });
const now = () => Math.floor(Date.now() / 1000);

let h: Harness;
beforeEach(() => (h = setupAccounts()));
afterEach(teardownAccounts);

describe("GET /auth/session", () => {
  const check = async (cookies: { name: string; value: string }[]) => {
    const res = await session(get("/auth/session", { cookies }));
    return { res, body: await res.json(), cookies: setCookies(res) };
  };

  it("no session cookie → signed-out (none), without asking Supabase", async () => {
    const { body, res } = await check([{ name: SESSION_COOKIE, value: "x" }]);
    expect(body).toEqual({ state: "signed-out", reason: "none" });
    expect(res.status).toBe(200);
    expect(h.server.calls).toHaveLength(0);
  });

  it("a session Supabase vouches for → verified, with the user from Supabase's answer and no cookie change", async () => {
    h.server.reply("user", { status: 200, body: USER });
    const { body, res, cookies } = await check(await signedInCookies(3600));
    expect(body).toMatchObject({ state: "verified", user: { id: USER_ID, email: "a@example.test", emailVerified: true } });
    expect(new Date(body.verifiedAt).toString()).not.toBe("Invalid Date");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(cookies.size).toBe(0);
    // A fresh session needs no refresh, so no refresh budget is spent; the check itself is limited per session (M2).
    expect(h.store.checks.map((c) => c.bucket)).toEqual(["session-check:sid"]);
  });

  it("an expired session is refreshed (within the refresh limits) and the rotated session is written back", async () => {
    const fresh = sessionBody(3600);
    h.server.reply("refresh", { status: 200, body: fresh });
    h.server.reply("user", { status: 200, body: USER });
    const { body, res } = await check(await signedInCookies(-10));
    expect(body.state).toBe("verified");
    expect((await sessionIn(res))?.refresh_token).toBe(fresh.refresh_token);
    expect(h.store.checks.map((c) => c.bucket)).toEqual(["session:ip", "session:sid", "session:global"]);
  });

  for (const [code, status, reason] of [
    ["session_not_found", 403, "revoked"],
    ["refresh_token_not_found", 400, "revoked"],
    ["refresh_token_already_used", 400, "revoked"],
    ["session_expired", 403, "expired"],
    ["bad_jwt", 401, "expired"],
    ["user_not_found", 404, "deleted"],
    ["user_banned", 403, "banned"],
  ] as const) {
    it(`${code} → signed-out (${reason}), and the session cookies are deleted`, async () => {
      const onRefresh = code.startsWith("refresh_token");
      h.server.reply(onRefresh ? "refresh" : "user", err(status, code));
      const { body, cookies } = await check(await signedInCookies(onRefresh ? -10 : 3600));
      expect(body).toEqual({ state: "signed-out", reason });
      expect(isDeletion(cookies.get(COOKIE))).toBe(true);
    });
  }

  it("a garbled session cookie → signed-out (none), the cookie removed, Supabase never asked", async () => {
    const { body, cookies } = await check([{ name: COOKIE, value: "base64-not-json" }]);
    expect(body).toEqual({ state: "signed-out", reason: "none" });
    expect(isDeletion(cookies.get(COOKIE))).toBe(true);
    expect(h.server.calls).toHaveLength(0);
  });

  for (const [why, reply] of [
    ["Supabase down (503)", { status: 503, body: {} }],
    ["rate limited (429)", err(429, "over_request_rate_limit")],
    ["the network failing", "network"],
  ] as const) {
    it(`${why} → unavailable, and no cookie is touched`, async () => {
      h.server.reply("user", reply as Reply);
      const { body, cookies } = await check(await signedInCookies(3600));
      expect(body).toEqual({ state: "unavailable" });
      expect(cookies.size).toBe(0);
    });
  }

  it("refresh succeeded but /user then failed → unavailable, AND the rotated session is still written back", async () => {
    // Otherwise the browser keeps the refresh token Supabase just used, and is signed out at the next refresh.
    const fresh = sessionBody(3600);
    h.server.reply("refresh", { status: 200, body: fresh });
    h.server.reply("user", { status: 503, body: {} }, { status: 503, body: {} }, { status: 503, body: {} });
    const { body, res, cookies } = await check(await signedInCookies(-10));
    expect(body).toEqual({ state: "unavailable" });
    expect((await sessionIn(res))?.refresh_token).toBe(fresh.refresh_token);
    expect([...cookies.values()].some(isDeletion)).toBe(false);
  });

  it("a refresh answered 200 without a session → unavailable, and auth-js's removal is NOT passed on", async () => {
    h.server.reply("refresh", { status: 200, body: {} });
    const { body, cookies } = await check(await signedInCookies(-10));
    expect(body).toEqual({ state: "unavailable" });
    expect(cookies.size).toBe(0);
  });

  it("an expiring session over the refresh limits → unavailable, Supabase never asked", async () => {
    h.store.refuse.add("session:ip");
    const { body, cookies } = await check(await signedInCookies(-10));
    expect(body).toEqual({ state: "unavailable" });
    expect(cookies.size).toBe(0);
    expect(h.server.calls).toHaveLength(0);
  });

  it("an expiring session with the rate-limit store unavailable → unavailable (fail closed)", async () => {
    setStoreForTests(null);
    expect((await check(await signedInCookies(-10))).body).toEqual({ state: "unavailable" });
    expect(h.server.calls).toHaveLength(0);
  });

  it("cookies are HttpOnly, SameSite=Lax, Path=/, and Secure over https", async () => {
    h.server.reply("refresh", { status: 200, body: sessionBody(3600) });
    h.server.reply("user", { status: 200, body: USER });
    const res = await session(get("/auth/session", { cookies: await signedInCookies(-10), headers: { "x-forwarded-proto": "https" } }));
    const line = setCookies(res).get(COOKIE)!;
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/SameSite=lax/i);
    expect(line).toMatch(/Path=\//);
    expect(line).toMatch(/Secure/i);
  });
});

describe("POST /auth/signout", () => {
  it("revokes this session at Supabase (scope local) and deletes every session cookie, chunks included", async () => {
    h.server.reply("logout", { status: 200, body: {} });
    const cookies = [...(await signedInCookies(3600, "x".repeat(5000))), { name: SESSION_COOKIE, value: "gate" }, { name: "theme", value: "dark" }];
    expect(cookies.filter((c) => c.name.startsWith(`${COOKIE}.`)).length).toBeGreaterThan(1); // chunked
    const res = await signout(post("/auth/signout", {}, { cookies }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    const logout = h.server.calls.find((c) => c.endpoint === "logout")!;
    expect(new URL(logout.url).searchParams.get("scope")).toBe("local");
    const set = setCookies(res);
    for (const c of cookies.filter((c) => c.name.startsWith(COOKIE))) expect(isDeletion(set.get(c.name))).toBe(true);
    // The app-password cookie and everything else are left alone, and nothing is cleared site-wide.
    expect(set.has(SESSION_COOKIE)).toBe(false);
    expect(set.has("theme")).toBe(false);
    expect(res.headers.get("clear-site-data")).toBeNull();
  });

  it("Supabase unreachable → still signed out here: {} and the cookies deleted", async () => {
    h.server.reply("logout", "network");
    const res = await signout(post("/auth/signout", {}, { cookies: await signedInCookies(3600) }));
    expect(res.status).toBe(200);
    expect(isDeletion(setCookies(res).get(COOKIE))).toBe(true);
  });

  it("no session → {} without asking Supabase", async () => {
    const res = await signout(post("/auth/signout", {}));
    expect(await res.json()).toEqual({});
    expect(h.server.calls).toHaveLength(0);
  });

  it("an expiring session over the refresh limits: no call to Supabase, but the cookies are still deleted", async () => {
    h.store.refuse.add("session:ip");
    const res = await signout(post("/auth/signout", {}, { cookies: await signedInCookies(-10) }));
    expect(h.server.calls).toHaveLength(0);
    expect(isDeletion(setCookies(res).get(COOKIE))).toBe(true);
  });

  it("a cross-site sign-out is refused and deletes nothing", async () => {
    const res = await signout(post("/auth/signout", {}, { cookies: await signedInCookies(3600), headers: { "sec-fetch-site": "cross-site", origin: "https://evil.example" } }));
    expect(res.status).toBe(403);
    expect(setCookies(res).size).toBe(0);
    expect(h.server.calls).toHaveLength(0);
  });
});

describe("POST /auth/update-password", () => {
  const GOOD = "a brand new passphrase";
  const SID = "sess-recovery-1";
  /** The session a recovery link gave: cookies for session SID, plus the marker /auth/verify sets for it. */
  const recoverySession = async ({ sessionId = SID, markerFor = { user: USER_ID, session: SID }, issuedAgoS = 60, expiresIn = 3600, claims = {} as Record<string, unknown> } = {}) => {
    const cookies = await signedInCookies(expiresIn, "", { session_id: sessionId, ...claims });
    const marker = issueRecoveryMarker(null, markerFor.user, markerFor.session, Date.now() / 1000 - issuedAgoS);
    return [...cookies, { name: RECOVERY_COOKIE, value: marker! }];
  };
  /** Scripts a successful change: /user, logout(others), PUT /user, logout(others). */
  const happy = () => {
    h.server.reply("user", { status: 200, body: USER });
    h.server.reply("logout", { status: 200, body: {} }, { status: 200, body: {} });
    h.server.reply("update-user", { status: 200, body: USER });
  };
  const change = async (cookies: { name: string; value: string }[], body: object = { password: GOOD, expectedUserId: USER_ID }) => {
    const res = await updatePassword(post("/auth/update-password", body, { cookies }));
    return { res, status: res.status, body: await res.json(), cookies: setCookies(res) };
  };
  const endpoints = () => h.server.calls.map((c) => c.endpoint);

  it("a recovery session with its marker: signs out the other sessions, changes the password, signs them out again → {}", async () => {
    happy();
    const r = await change(await recoverySession());
    expect(r.status).toBe(200);
    expect(r.body).toEqual({});
    expect(endpoints()).toEqual(["user", "logout", "update-user", "logout"]);
    for (const c of h.server.calls.filter((c) => c.endpoint === "logout")) expect(new URL(c.url).searchParams.get("scope")).toBe("others");
    expect(h.server.calls.find((c) => c.endpoint === "update-user")?.body).toMatchObject({ password: GOOD });
    expect(h.store.checks.map((c) => c.bucket)).toEqual(["reset:ip", "session-check:sid"]);
    expect(isDeletion(r.cookies.get(RECOVERY_COOKIE))).toBe(true); // the marker works once
  });

  it("/user is asked about exactly the access token whose claims are then read, and D6 uses that token too", async () => {
    // Expired, so getSession() refreshes first: the token checked and read must be the NEW one, not the cookie's.
    const fresh = sessionBody(3600, "", { session_id: SID });
    h.server.reply("refresh", { status: 200, body: fresh });
    happy();
    const r = await change(await recoverySession({ expiresIn: -10 }));
    expect(r.status).toBe(200);
    const bearerOf = (e: string) => h.server.calls.filter((c) => c.endpoint === e).map((c) => c.bearer);
    expect(bearerOf("user")).toEqual([fresh.access_token]);
    expect(bearerOf("logout")).toEqual([fresh.access_token, fresh.access_token]);
  });

  for (const [why, opts] of [
    ["no recovery marker at all (an ordinary session)", null],
    ["a marker issued over 15 minutes ago", { issuedAgoS: 16 * 60 }],
    ["a marker for another session of the same account", { markerFor: { user: USER_ID, session: "sess-other" } }],
    ["a marker for another account", { markerFor: { user: "0f8fad5b-0000-0000-0000-000000000000", session: SID } }],
    ["a token whose subject isn't the verified user", { claims: { sub: "someone-else" } }],
    ["a password sign-in a minute ago (requirement 9: recovery only)", { claims: { amr: [{ method: "password", timestamp: now() - 60 }] }, markerFor: { user: USER_ID, session: "none" } }],
    ["a token claiming amr recovery but without the marker", { claims: { amr: [{ method: "recovery", timestamp: now() - 60 }] }, markerFor: { user: USER_ID, session: "none" } }],
  ] as const) {
    it(`refused for ${why} → 401 session_missing, nothing changed`, async () => {
      happy();
      const cookies = opts === null ? await signedInCookies(3600, "", { session_id: SID }) : await recoverySession(opts);
      const r = await change(cookies);
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: { code: "session_missing" } });
      expect(endpoints()).not.toContain("update-user");
      expect(endpoints()).not.toContain("logout");
    });
  }

  it("a tampered or garbled marker → 401", async () => {
    for (const value of ["", "123.abc", `${now() + 600}.${"A".repeat(43)}`, "x".repeat(200)]) {
      happy();
      const cookies = [...(await signedInCookies(3600, "", { session_id: SID })), { name: RECOVERY_COOKIE, value }];
      expect((await change(cookies)).status).toBe(401);
    }
  });

  it("expectedUserId is only compared, never used: another id → 409 user_mismatch, nothing changed", async () => {
    happy();
    const r = await change(await recoverySession(), { password: GOOD, expectedUserId: "0f8fad5b-0000-0000-0000-000000000000" });
    expect(r.status).toBe(409);
    expect(r.body).toEqual({ error: { code: "user_mismatch" } });
    expect(endpoints()).toEqual(["user"]);
  });

  it("not signed in → 401 session_missing, Supabase never asked", async () => {
    const r = await change([]);
    expect(r.body).toEqual({ error: { code: "session_missing" } });
    expect(h.server.calls).toHaveLength(0);
  });

  it("a revoked session → 401 session_missing and its cookies deleted", async () => {
    h.server.reply("user", err(403, "session_not_found"));
    const r = await change(await recoverySession());
    expect(r.body).toEqual({ error: { code: "session_missing" } });
    expect(isDeletion(r.cookies.get(COOKIE))).toBe(true);
  });

  it("an expired recovery session whose refresh token is gone → 401 session_missing", async () => {
    h.server.reply("refresh", err(400, "refresh_token_not_found"));
    expect((await change(await recoverySession({ expiresIn: -10 }))).body).toEqual({ error: { code: "session_missing" } });
  });

  it("Supabase down while checking → 503 unavailable, no cookie removed, nothing changed", async () => {
    h.server.reply("user", { status: 503, body: {} }, { status: 503, body: {} }, { status: 503, body: {} });
    const r = await change(await recoverySession());
    expect(r.status).toBe(503);
    expect(r.cookies.size).toBe(0);
    expect(endpoints()).not.toContain("update-user");
  });

  for (const [why, reply] of [
    ["fails (500)", { status: 500, body: { code: "unexpected_failure", msg: "x" } }],
    ["is refused with 401 (auth.signOut would have called that success)", err(401, "bad_jwt")],
    ["is refused with 403", err(403, "session_not_found")],
    ["is refused with 404", err(404, "user_not_found")],
    ["can't be reached", "network"],
  ] as const) {
    it(`D6: if signing out the other sessions ${why}, the password is NOT changed (503, a retry works)`, async () => {
      h.server.reply("user", { status: 200, body: USER });
      h.server.reply("logout", reply as Reply);
      const r = await change(await recoverySession());
      expect(r.status).toBe(503);
      expect(endpoints()).not.toContain("update-user");
    });
  }

  for (const [code, expected] of [
    ["same_password", { status: 422, body: { error: { code: "same_password", field: "password" } } }],
    ["weak_password", { status: 422, body: { error: { code: "weak_password", field: "password" } } }],
    ["reauthentication_needed", { status: 401, body: { error: { code: "session_missing" } } }],
  ] as const) {
    it(`Supabase refuses the new password with ${code} → ${expected.body.error.code}`, async () => {
      h.server.reply("user", { status: 200, body: USER });
      h.server.reply("logout", { status: 200, body: {} });
      h.server.reply("update-user", err(422, code));
      const r = await change(await recoverySession());
      expect({ status: r.status, body: r.body }).toEqual(expected);
    });
  }

  it("the password policy is checked first: too short → 422 weak_password, over 72 bytes → 400 invalid_input; Supabase never asked", async () => {
    const cookies = await recoverySession();
    expect((await change(cookies, { password: "ninechars", expectedUserId: USER_ID })).body).toEqual({ error: { code: "weak_password", field: "password" } });
    expect((await change(cookies, { password: "é".repeat(37), expectedUserId: USER_ID })).body).toEqual({ error: { code: "invalid_input", field: "password" } }); // 74 bytes
    expect((await change(cookies, { password: 1234567890123, expectedUserId: USER_ID })).body).toEqual({ error: { code: "invalid_input", field: "password" } });
    expect((await change(cookies, { password: GOOD })).body).toEqual({ error: { code: "invalid_input" } }); // no expectedUserId
    expect(h.server.calls).toHaveLength(0);
  });

  it("10 characters and exactly 72 bytes are both accepted (no composition rules)", async () => {
    for (const password of ["aaaaaaaaaa", "€".repeat(24)]) {
      happy();
      expect((await change(await recoverySession(), { password, expectedUserId: USER_ID })).status).toBe(200);
    }
  });

  it("over the reset limit → 429 with Retry-After, Supabase never asked", async () => {
    h.store.refuse.add("reset:ip");
    const r = await change(await recoverySession());
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe("rate_limited");
    expect(Number(r.res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(h.server.calls).toHaveLength(0);
  });

  it("a session rotated while checking is written back even when the change is then refused", async () => {
    const fresh = sessionBody(3600, "", { session_id: SID });
    h.server.reply("refresh", { status: 200, body: fresh });
    h.server.reply("user", { status: 200, body: USER });
    h.server.reply("logout", { status: 200, body: {} });
    h.server.reply("update-user", err(422, "same_password"));
    const r = await change(await recoverySession({ expiresIn: -10 }));
    expect(r.status).toBe(422);
    expect((await sessionIn(r.res))?.refresh_token).toBe(fresh.refresh_token);
  });
});

// Security review finding 1: auth-js refreshes on ANY truthy expires_at it reads as past, so a cookie whose
// expires_at isn't a plain number must count against the refresh limits too, or anyone could make this server call
// Supabase's /token without limit (and use up the /token budget every student shares).
// The access token here is one that can't be checked locally (HS256), so the cookie isn't rejected as forged and
// must go through the limits (forged ones never reach them: src/app/auth/session-proof.test.ts).
describe("refresh limits can't be skipped with an odd expires_at", () => {
  const b64 = (o: unknown) => "base64-" + Buffer.from(JSON.stringify(o)).toString("base64url");
  const forged = (expires_at: unknown) => [
    { name: COOKIE, value: b64({ access_token: hs256AccessToken(now() - 10), refresh_token: "r", token_type: "bearer", expires_at, user: { id: USER_ID } }) },
  ];
  for (const [why, value] of [
    ["a string", "1"],
    ["true", true],
    ["an array", [1]],
    ["missing", undefined],
    ["a number in the past", 1],
  ] as const) {
    it(`expires_at ${why}: over the limit → no call to Supabase from /auth/session, /auth/signout or /auth/update-password`, async () => {
      h.store.refuse.add("session:ip");
      const cookies = forged(value);
      expect(await (await session(get("/auth/session", { cookies }))).json()).toEqual({ state: "unavailable" });
      await signout(post("/auth/signout", {}, { cookies }));
      expect((await updatePassword(post("/auth/update-password", { password: "a brand new passphrase", expectedUserId: USER_ID }, { cookies }))).status).toBe(503);
      expect(h.server.calls).toHaveLength(0);
      expect(h.store.checks.filter((c) => c.bucket === "session:ip").length).toBe(3);
    });
  }
  it("the CONTROL: such a cookie really does make auth-js refresh (when the limits allow it)", async () => {
    h.server.reply("refresh", err(400, "refresh_token_not_found"));
    await session(get("/auth/session", { cookies: forged("1") }));
    expect(h.server.calls.map((c) => c.endpoint)).toEqual(["refresh"]);
  });
});

// Security review finding 6: a refresh may write NEW chunk names before Supabase says the session is gone.
it("signed out after a refresh that wrote a bigger session: every session cookie name is deleted, none is set", async () => {
  h.server.reply("refresh", { status: 200, body: sessionBody(3600, "y".repeat(6000)) }); // the rotated session needs chunks
  h.server.reply("user", err(403, "user_banned"));
  const res = await session(get("/auth/session", { cookies: await signedInCookies(-10) })); // a small, single-cookie session
  expect(await res.json()).toEqual({ state: "signed-out", reason: "banned" });
  const set = setCookies(res);
  expect([...set.keys()].filter((n) => n.startsWith(`${COOKIE}.`)).length).toBeGreaterThan(1); // the chunk names it wrote…
  for (const [name, line] of set) if (name.startsWith(COOKIE)) expect(isDeletion(line)).toBe(true); // …are all deletions
  expect(await sessionIn(res)).toBeNull();
});
