import { afterEach, describe, expect, it, vi } from "vitest";
import { resetAccountsConfigForTests } from "./env";
import { authEndpoint, createSupabaseServerClient, secureCookieOptions, timedFetch } from "./server";
import type { AuthCallLog } from "./session-policy";

afterEach(() => {
  vi.unstubAllEnvs();
  resetAccountsConfigForTests();
});

describe("Supabase cookie flags", () => {
  it("forces HttpOnly, SameSite=Lax, Path=/ and Secure on https, whatever Supabase asks for", () => {
    const o = secureCookieOptions({ httpOnly: false, sameSite: "none", path: "/x", secure: false, maxAge: 400 }, true);
    expect(o).toEqual({ httpOnly: true, sameSite: "lax", path: "/", secure: true, maxAge: 400 });
  });
  it("keeps Supabase's expiry, so deleting a cookie (maxAge 0) still deletes it", () => {
    expect(secureCookieOptions({ maxAge: 0 }, true).maxAge).toBe(0);
  });
  it("can't be Secure over plain http (a laptop copy), but is still HttpOnly", () => {
    expect(secureCookieOptions({}, false)).toMatchObject({ httpOnly: true, secure: false, sameSite: "lax" });
  });
});

describe("createSupabaseServerClient", () => {
  it("returns no client while accounts are off", () => {
    vi.stubEnv("SUPABASE_URL", "");
    expect(createSupabaseServerClient({ getAll: () => [], set: () => {} }, { https: true })).toBeNull();
  });
});

describe("timedFetch (every Supabase call has a time limit)", () => {
  it("aborts a call that doesn't answer in time", async () => {
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))));
    try {
      await expect(timedFetch(50)("https://devref.supabase.co/auth/v1/user")).rejects.toMatchObject({ name: "TimeoutError" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("after a shared deadline, sends nothing and answers 408 (which Supabase's client won't retry)", async () => {
    const sent = vi.fn();
    vi.stubGlobal("fetch", sent);
    try {
      const deadline = AbortSignal.abort();
      const res = await timedFetch(10_000, deadline)("https://devref.supabase.co/auth/v1/token?grant_type=refresh_token");
      expect(res.status).toBe(408);
      expect(sent).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("cuts off a call in flight when the shared deadline passes", async () => {
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))));
    try {
      await expect(timedFetch(10_000, AbortSignal.timeout(50))("https://devref.supabase.co/auth/v1/user")).rejects.toMatchObject({ name: "TimeoutError" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("records every /token and /user answer (status and Supabase's code), in order, without using up the body", async () => {
    const answer = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const replies = [answer(403, { code: "session_not_found", msg: "x" }), answer(200, { id: "u" }), answer(400, { error_code: "refresh_token_not_found" }), answer(500, { msg: "x" })];
    vi.stubGlobal("fetch", async () => replies.shift()!);
    try {
      const log: AuthCallLog = { calls: [] };
      const f = timedFetch(10_000, undefined, log);
      const r1 = await f("https://devref.supabase.co/auth/v1/user");
      expect(log.calls.at(-1)).toEqual({ endpoint: "user", status: 403, code: "session_not_found" });
      expect(await r1.json()).toMatchObject({ code: "session_not_found" }); // auth-js can still read it
      await f("https://devref.supabase.co/auth/v1/user");
      expect(log.calls.at(-1)).toEqual({ endpoint: "user", status: 200, code: undefined });
      await f("https://devref.supabase.co/auth/v1/token?grant_type=refresh_token");
      expect(log.calls.at(-1)).toEqual({ endpoint: "refresh", status: 400, code: "refresh_token_not_found" });
      await f("https://devref.supabase.co/rest/v1/anything");
      expect(log.calls).toHaveLength(3); // the /rest call isn't logged; the three auth answers are all kept, in order
      expect(log.calls.map((c) => c.status)).toEqual([403, 200, 400]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("records no answer (status 0) for a network failure or a call after the deadline", async () => {
    vi.stubGlobal("fetch", async () => Promise.reject(new TypeError("fetch failed")));
    try {
      const log: AuthCallLog = { calls: [] };
      await expect(timedFetch(10_000, undefined, log)("https://devref.supabase.co/auth/v1/user")).rejects.toThrow("fetch failed");
      expect(log.calls.at(-1)).toEqual({ endpoint: "user", status: 0 });
      await timedFetch(10_000, AbortSignal.abort(), log)("https://devref.supabase.co/auth/v1/token?grant_type=refresh_token");
      expect(log.calls.at(-1)).toEqual({ endpoint: "refresh", status: 0 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("still honours the caller's own abort signal", async () => {
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))));
    try {
      const c = new AbortController();
      const p = timedFetch(10_000)("https://devref.supabase.co/auth/v1/user", { signal: c.signal });
      c.abort(new Error("cancelled"));
      await expect(p).rejects.toThrow("cancelled");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});


// R2: /token is one URL for both refreshing the current session and signing in. Only the first is evidence about the
// session the client holds; the call log tells them apart by grant_type.
describe("authEndpoint: which answers are about the current session", () => {
  const base = "https://devrefaaaaaaaaaaaaaa.supabase.co/auth/v1";
  it("a refresh is grant_type=refresh_token, and nothing else", () => {
    expect(authEndpoint(`${base}/token?grant_type=refresh_token`)).toBe("refresh");
    expect(authEndpoint(`${base}/token?foo=1&grant_type=refresh_token`)).toBe("refresh");
  });
  it("every other grant, /verify and /signup are sign-ins (they can start a session)", () => {
    for (const g of ["password", "pkce", "id_token", "web3"]) expect(authEndpoint(`${base}/token?grant_type=${g}`)).toBe("sign-in");
    expect(authEndpoint(`${base}/verify`)).toBe("sign-in");
    expect(authEndpoint(`${base}/signup`)).toBe("sign-in");
  });
  it("a /token call with a missing, empty, look-alike or repeated grant_type is NOT a refresh", () => {
    expect(authEndpoint(`${base}/token`)).toBe("sign-in");
    expect(authEndpoint(`${base}/token?grant_type=`)).toBe("sign-in");
    expect(authEndpoint(`${base}/token?grant_type=refresh_token_x`)).toBe("sign-in");
    expect(authEndpoint(`${base}/token?grant_type=password&grant_type=refresh_token`)).toBe("sign-in"); // the first value wins
    expect(authEndpoint(`${base}/token?x=grant_type=refresh_token`)).toBe("sign-in"); // not fooled by a substring
  });
  it("/user is about the current session; everything else is not logged", () => {
    expect(authEndpoint(`${base}/user`)).toBe("user");
    for (const p of ["logout", "otp", "recover", "settings", "factors/x/verify"]) expect(authEndpoint(`${base}/${p}`)).toBeNull();
    expect(authEndpoint("https://devrefaaaaaaaaaaaaaa.supabase.co/rest/v1/anything")).toBeNull();
    expect(authEndpoint("not a url")).toBeNull();
  });
});

describe("timedFetch: sign-in answers are logged apart, with whether they started a session", () => {
  afterEach(() => vi.unstubAllGlobals());
  const json = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  it("marks only a sign-in that returned a session, and leaves the body readable", async () => {
    const replies = [
      json(200, { access_token: "a", refresh_token: "r", user: {} }),
      json(400, { code: "invalid_credentials", msg: "x" }),
      json(200, { user: {} }), // e.g. sign-up waiting for email confirmation: no session
      json(200, { access_token: "a", refresh_token: "r" }), // a refresh with a session: logged as a refresh, never as a new start
    ];
    vi.stubGlobal("fetch", async () => replies.shift()!);
    const log: AuthCallLog = { calls: [] };
    const f = timedFetch(10_000, undefined, log);
    const base = "https://devrefaaaaaaaaaaaaaa.supabase.co/auth/v1";
    const r = await f(`${base}/token?grant_type=password`);
    expect(await r.json()).toMatchObject({ access_token: "a" });
    await f(`${base}/token?grant_type=password`);
    await f(`${base}/signup`);
    await f(`${base}/token?grant_type=refresh_token`);
    expect(log.calls).toEqual([
      { endpoint: "sign-in", status: 200, code: undefined, session: true },
      { endpoint: "sign-in", status: 400, code: "invalid_credentials" },
      { endpoint: "sign-in", status: 200, code: undefined },
      { endpoint: "refresh", status: 200, code: undefined },
    ]);
  });
});
