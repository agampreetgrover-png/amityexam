import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServerClient, callLogOf } from "@/lib/supabase/server";
import { fakeSupabase, sessionBody, signedInCookies, SUPABASE_URL, type Reply } from "@/test/fake-supabase";
import { requireUser, verifyUser } from "./auth";

/** A stand-in Supabase client whose getUser() answers (or throws) as given. */
const client = (answer: unknown) =>
  ({
    auth: {
      getUser: async () => {
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  }) as unknown as SupabaseClient;
const failed = (error: Error) => client({ data: { user: null }, error });

const USER = { id: "0f8fad5b-d9cb-469f-a165-70867728950e", email: "a@example.test", email_confirmed_at: "2026-11-01T00:00:00Z" };

describe("verifyUser (asks Supabase Auth with getUser)", () => {
  it("returns the user Supabase vouches for", async () => {
    expect(await verifyUser(client({ data: { user: USER }, error: null }))).toEqual({
      status: "ok",
      user: { id: USER.id, email: USER.email, emailVerified: true },
    });
  });

  it("no session cookie at all → signed out", async () => {
    expect(await verifyUser(failed(new AuthSessionMissingError()))).toEqual({ status: "signed-out", code: "session_missing" });
  });

  it("a deleted user → signed out", async () => {
    expect(await verifyUser(failed(new AuthApiError("User not found", 404, "user_not_found")))).toEqual({ status: "signed-out", code: "user_not_found" });
  });

  it("a forged or garbled token → signed out", async () => {
    expect(await verifyUser(failed(new AuthApiError("invalid JWT", 401, "bad_jwt")))).toMatchObject({ status: "signed-out" });
  });

  it("Supabase unreachable, timing out or failing → unavailable, never signed in", async () => {
    expect(await verifyUser(failed(new AuthRetryableFetchError("fetch failed", 0)))).toEqual({ status: "unavailable" });
    expect(await verifyUser(failed(new AuthApiError("boom", 500, "unexpected_failure")))).toEqual({ status: "unavailable" });
    expect(await verifyUser(client(new Error("socket hang up")))).toEqual({ status: "unavailable" });
  });

  it("Supabase timing out (408) or rate limiting (429) → unavailable, never 'signed out'", async () => {
    expect(await verifyUser(failed(new AuthApiError("Request timeout", 408, "request_timeout")))).toEqual({ status: "unavailable" });
    expect(await verifyUser(failed(new AuthApiError("Too many requests", 429, "over_request_rate_limit")))).toEqual({ status: "unavailable" });
  });

  it("an answer Supabase's client couldn't read (AuthUnknownError) → unavailable", async () => {
    expect(await verifyUser(failed(new AuthUnknownError("Unexpected token <", new Error("html"))))).toEqual({ status: "unavailable" });
  });

  it("a success with no user in it confirms nobody → unavailable (never opens anything, never signs out)", async () => {
    expect(await verifyUser(client({ data: { user: null }, error: null }))).toEqual({ status: "unavailable" });
  });

  it("an error Supabase doesn't call definitive (e.g. validation_failed) → unavailable, not signed out", async () => {
    expect(await verifyUser(failed(new AuthApiError("bad input", 400, "validation_failed")))).toEqual({ status: "unavailable" });
  });

  it("an unverified email is reported as such", async () => {
    const r = await verifyUser(client({ data: { user: { ...USER, email_confirmed_at: null } }, error: null }));
    expect(r).toMatchObject({ status: "ok", user: { emailVerified: false } });
  });
});

describe("requireUser", () => {
  it("gives the user only when verified, and null for both signed out and unknown", async () => {
    expect(await requireUser(client({ data: { user: USER }, error: null }))).toMatchObject({ id: USER.id });
    expect(await requireUser(failed(new AuthSessionMissingError()))).toBeNull();
    expect(await requireUser(failed(new AuthRetryableFetchError("down", 0)))).toBeNull();
  });
});

// The same, through the REAL @supabase/ssr and auth-js (error mapping included) against a fake Supabase server.
// buildServerClient is the app's own client (timedFetch with its call log, the cookie rules); fetch is stubbed with
// the fake server, so auth-js's real error mapping decides what verifyUser sees.
describe("verifyUser with the real Supabase client", () => {
  afterEach(() => vi.unstubAllGlobals());
  /** A session expiring in `expiresIn` seconds; the fake server answers /token and /user as scripted. */
  const verifyWith = async (expiresIn: number, script: (server: ReturnType<typeof fakeSupabase>) => void) => {
    const cookies = await signedInCookies(expiresIn);
    const server = fakeSupabase();
    script(server);
    vi.stubGlobal("fetch", server.fetch);
    const supabase = buildServerClient(SUPABASE_URL, "sb_publishable_test", { getAll: () => cookies, set: () => {} }, { https: false });
    return { result: await verifyUser(supabase), server };
  };
  const verify = async (reply: Reply) => (await verifyWith(3600, (s) => s.reply("user", reply))).result;

  it("a signed-in user Supabase vouches for → ok", async () => {
    const r = await verify({ status: 200, body: { id: "0f8fad5b-d9cb-469f-a165-70867728950e", aud: "authenticated", email: "a@example.test", email_confirmed_at: "2026-11-01T00:00:00Z" } });
    expect(r).toMatchObject({ status: "ok", user: { id: "0f8fad5b-d9cb-469f-a165-70867728950e", emailVerified: true } });
  });
  it("a revoked session (session_not_found, which auth-js turns into AuthSessionMissingError) → signed out", async () => {
    expect(await verify({ status: 403, body: { code: "session_not_found", msg: "Session not found" } })).toMatchObject({ status: "signed-out" });
  });
  it("a deleted user (user_not_found) → signed out", async () => {
    expect(await verify({ status: 404, body: { code: "user_not_found", msg: "User not found" } })).toEqual({ status: "signed-out", code: "user_not_found" });
  });
  it("Supabase rate limiting (429) → unavailable", async () => {
    expect(await verify({ status: 429, body: { code: "over_request_rate_limit", msg: "slow down" } })).toEqual({ status: "unavailable" });
  });
  it("Supabase down (503) → unavailable", async () => {
    expect(await verify({ status: 503, body: {} })).toEqual({ status: "unavailable" });
  });
  it("a bad or forged token (bad_jwt) → signed out", async () => {
    expect(await verify({ status: 401, body: { code: "bad_jwt", msg: "invalid JWT" } })).toEqual({ status: "signed-out", code: "bad_jwt" });
  });
  it("an unexpected 4xx (validation_failed) → unavailable, not signed out", async () => {
    expect(await verify({ status: 400, body: { code: "validation_failed", msg: "x" } })).toEqual({ status: "unavailable" });
  });
  it("an expired session whose refresh answers 200 without a session → unavailable, not signed out", async () => {
    const { result, server } = await verifyWith(-10, (s) => s.reply("refresh", { status: 200, body: {} }));
    expect(server.calls.map((c) => c.endpoint)).toContain("refresh");
    expect(result).toEqual({ status: "unavailable" });
  });
  it("an expired session whose refresh token is gone (refresh_token_not_found) → signed out", async () => {
    const { result } = await verifyWith(-10, (s) => s.reply("refresh", { status: 400, body: { code: "refresh_token_not_found", msg: "Invalid Refresh Token" } }));
    expect(result).toMatchObject({ status: "signed-out", code: "refresh_token_not_found" });
  });
  it("an expired session that refreshes fine → ok (and the new session is used for /user)", async () => {
    const { result } = await verifyWith(-10, (s) => {
      s.reply("refresh", { status: 200, body: sessionBody(3600) });
      s.reply("user", { status: 200, body: { id: "0f8fad5b-d9cb-469f-a165-70867728950e", aud: "authenticated", email: "a@example.test" } });
    });
    expect(result).toMatchObject({ status: "ok" });
  });
});

// M1: Supabase's client starts refreshing an expired session as soon as it is CREATED, before verifyUser runs. The
// answer to that refresh is part of this request's evidence and is never cleared, so the verdict can't depend on how
// long the route waits between creating the client and checking the user.
describe("verifyUser: evidence from the refresh that starts when the client is created", () => {
  afterEach(() => vi.unstubAllGlobals());
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** One fake Supabase for the whole test (fetch is global); each client gets its own cookies and call log. */
  const setup = () => {
    const server = fakeSupabase();
    vi.stubGlobal("fetch", server.fetch);
    const client = async (expiresIn: number | null, options: { deadline?: AbortSignal } = {}) => {
      const cookies = expiresIn === null ? [] : await signedInCookies(expiresIn);
      return buildServerClient(SUPABASE_URL, "sb_publishable_test", { getAll: () => cookies, set: () => {} }, { https: false, ...options });
    };
    return { server, client };
  };

  for (const delay of [0, 30]) {
    const when = delay ? delay + "ms after the client is created" : "immediately";
    it("a refresh answered 200 without a session, checked " + when + " → unavailable (never signed out)", async () => {
      const { server, client } = setup();
      server.reply("refresh", { status: 200, body: {} });
      const supabase = await client(-10);
      if (delay) await pause(delay);
      expect(await verifyUser(supabase)).toEqual({ status: "unavailable" });
      expect(callLogOf(supabase)?.calls.map((c) => [c.endpoint, c.status])).toEqual([["refresh", 200]]);
    });

    it("a temporary network failure on refresh, checked " + when + " → unavailable", async () => {
      const { server, client } = setup();
      server.reply("refresh", ...Array.from({ length: 10 }, () => "network" as const));
      // auth-js retries network failures for up to ~30s; a request deadline (as routes will have) ends that early.
      const supabase = await client(-10, { deadline: AbortSignal.timeout(400) });
      if (delay) await pause(delay);
      expect(await verifyUser(supabase)).toEqual({ status: "unavailable" });
      expect(callLogOf(supabase)?.calls.every((c) => c.status === 0 || c.status === 408)).toBe(true);
    });

    it("a genuinely revoked session (session_not_found), checked " + when + " → signed out", async () => {
      const { server, client } = setup();
      server.reply("user", { status: 403, body: { code: "session_not_found", msg: "Session not found" } });
      const supabase = await client(3600);
      if (delay) await pause(delay);
      expect(await verifyUser(supabase)).toEqual({ status: "signed-out", code: "session_not_found" });
    });

    it("a revoked session found by the refresh itself (/token → session_not_found), checked " + when + " → signed out", async () => {
      const { server, client } = setup();
      server.reply("refresh", { status: 403, body: { code: "session_not_found", msg: "Session not found" } });
      const supabase = await client(-10);
      if (delay) await pause(delay);
      expect(await verifyUser(supabase)).toEqual({ status: "signed-out", code: "session_not_found" });
    });
  }

  it("a cached failure (auth-js reuses a recent refresh failure without asking again) → still unavailable", async () => {
    const { server, client } = setup();
    server.reply("refresh", { status: 200, body: {} });
    const supabase = await client(-10);
    expect(await verifyUser(supabase)).toEqual({ status: "unavailable" });
    await pause(30);
    expect(await verifyUser(supabase)).toEqual({ status: "unavailable" }); // the second check makes no new /token call…
    expect(server.calls.filter((c) => c.endpoint === "refresh")).toHaveLength(1); // …so only the kept record decides it
  });

  it("no session at all (no cookies, nothing asked) → signed out (session_missing)", async () => {
    const { server, client } = setup();
    const supabase = await client(null);
    expect(await verifyUser(supabase)).toEqual({ status: "signed-out", code: "session_missing" });
    expect(server.calls).toHaveLength(0);
  });

  it("independent clients keep independent records: one client's answers never decide another's", async () => {
    const { server, client } = setup();
    server.reply("refresh", { status: 200, body: {} }); // for B, whose session has expired
    server.reply("user", { status: 403, body: { code: "session_not_found", msg: "Session not found" } }); // for A
    const a = await client(3600); // valid session: makes no call until checked
    const b = await client(-10); // expired: starts its refresh now
    const c = await client(null); // no session at all
    await pause(30);
    // Checked in an order that would expose any shared state: C, then A (gets session_not_found), then B.
    expect(await verifyUser(c)).toEqual({ status: "signed-out", code: "session_missing" });
    expect(await verifyUser(a)).toEqual({ status: "signed-out", code: "session_not_found" });
    expect(await verifyUser(b)).toEqual({ status: "unavailable" }); // A's "session_not_found" is not B's evidence
    expect(callLogOf(a)?.calls.map((x) => x.code)).toEqual(["session_not_found"]);
    expect(callLogOf(b)?.calls.map((x) => x.endpoint)).toEqual(["refresh"]);
    expect(callLogOf(c)?.calls).toEqual([]);
  });
});

// F: every code that signs a student out, one by one, through the real client (no loop over the policy's own list).
describe("verifyUser: each definitive code signs out; temporary and unknown errors don't", () => {
  afterEach(() => vi.unstubAllGlobals());
  const check = async (reply: Reply, endpoint: "user" | "refresh" = "user") => {
    const server = fakeSupabase();
    vi.stubGlobal("fetch", server.fetch);
    server.reply(endpoint, reply);
    const cookies = await signedInCookies(endpoint === "refresh" ? -10 : 3600);
    return verifyUser(buildServerClient(SUPABASE_URL, "sb_publishable_test", { getAll: () => cookies, set: () => {} }, { https: false, deadline: AbortSignal.timeout(400) }));
  };
  const err = (status: number, code: string) => ({ status, body: { code, msg: code } });

  it("refresh_token_not_found → signed out", async () => expect(await check(err(400, "refresh_token_not_found"), "refresh")).toEqual({ status: "signed-out", code: "refresh_token_not_found" }));
  it("refresh_token_already_used → signed out", async () => expect(await check(err(400, "refresh_token_already_used"), "refresh")).toEqual({ status: "signed-out", code: "refresh_token_already_used" }));
  it("session_expired → signed out", async () => expect(await check(err(403, "session_expired"))).toEqual({ status: "signed-out", code: "session_expired" }));
  it("session_not_found → signed out", async () => expect(await check(err(403, "session_not_found"))).toEqual({ status: "signed-out", code: "session_not_found" }));
  it("user_not_found → signed out", async () => expect(await check(err(404, "user_not_found"))).toEqual({ status: "signed-out", code: "user_not_found" }));
  it("user_banned → signed out", async () => expect(await check(err(403, "user_banned"))).toEqual({ status: "signed-out", code: "user_banned" }));
  it("bad_jwt → signed out", async () => expect(await check(err(401, "bad_jwt"))).toEqual({ status: "signed-out", code: "bad_jwt" }));

  const temporary: [string, Reply][] = [
    ["rate limited (429)", err(429, "over_request_rate_limit")],
    ["timed out (408)", err(408, "request_timeout")],
    ["server error (500)", err(500, "unexpected_failure")],
    ["unavailable (503, no body)", { status: 503, body: {} }],
    ["a validation error", err(400, "validation_failed")],
    ["an unknown code", err(400, "some_new_code_supabase_adds_later")],
    ["an error without a code", { status: 403, body: { msg: "forbidden" } }],
    ["the network failing", "network"],
  ];
  for (const [why, reply] of temporary) {
    it(why + " → unavailable, not signed out", async () => expect(await check(reply)).toEqual({ status: "unavailable" }));
  }
});

// R1: the refresh that starts when the client is created can get ANY definitive answer, not only session_not_found.
// auth-js then removes the session itself, so a later getUser() reports only "Auth session missing!" and the code is
// left in the call log. Each code is checked by name (never looped from the policy's own list), immediately and after
// the route has awaited something else, and each must read as signed out with the code Supabase actually gave.
describe("R1: a definitive refresh answer, seen by a verifyUser that runs after an await", () => {
  afterEach(() => vi.unstubAllGlobals());
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const run = async (reply: Reply, delay: number) => {
    const server = fakeSupabase();
    vi.stubGlobal("fetch", server.fetch);
    server.reply("refresh", reply);
    const cookies = await signedInCookies(-10); // expired: auth-js refreshes as soon as the client exists
    const supabase = buildServerClient(SUPABASE_URL, "sb_publishable_test", { getAll: () => cookies, set: () => {} }, { https: false, deadline: AbortSignal.timeout(400) });
    if (delay) await pause(delay);
    const result = await verifyUser(supabase);
    return { result, server, log: callLogOf(supabase)! };
  };
  const err = (status: number, code: string): Reply => ({ status, body: { code, msg: code } });

  const definitive: [string, Reply][] = [
    ["refresh_token_not_found", err(400, "refresh_token_not_found")],
    ["refresh_token_already_used", err(400, "refresh_token_already_used")],
    ["session_expired", err(403, "session_expired")],
    ["session_not_found", err(403, "session_not_found")],
    ["user_not_found", err(404, "user_not_found")],
    ["user_banned", err(403, "user_banned")],
    ["bad_jwt", err(401, "bad_jwt")],
  ];
  for (const delay of [0, 30]) {
    const when = delay ? "after a " + delay + "ms await" : "immediately";
    for (const [code, reply] of definitive) {
      it(`/token → ${code}, checked ${when} → signed out (${code})`, async () => {
        const { result, server, log } = await run(reply, delay);
        expect(result).toEqual({ status: "signed-out", code });
        expect(server.calls.filter((c) => c.endpoint === "refresh")).toHaveLength(1); // one answer, never retried
        expect(log.calls.map((c) => c.code)).toEqual([code]);
      });
    }
  }

  // Negative controls: the same path, but with answers that don't say the session is gone. These must stay unavailable.
  const temporary: [string, Reply][] = [
    ["rate limited (429)", err(429, "over_request_rate_limit")],
    ["timed out (408)", err(408, "request_timeout")],
    ["server error (500)", err(500, "unexpected_failure")],
    ["unavailable (503, no body)", { status: 503, body: {} }],
    ["a validation error", err(400, "validation_failed")],
    ["an unknown code", err(400, "some_new_code_supabase_adds_later")],
    ["an error without a code", { status: 403, body: { msg: "forbidden" } }],
    ["a 200 without a session", { status: 200, body: {} }],
    ["the network failing", "network"],
    ["no answer before the deadline", "hang"],
  ];
  for (const [why, reply] of temporary) {
    it(`/token → ${why}, checked after a 30ms await → unavailable, not signed out`, async () => {
      expect((await run(reply, 30)).result).toEqual({ status: "unavailable" });
    });
  }
});

// R2: a sign-in route's client may inherit a stale session from the cookies. auth-js refreshes that one as soon as the
// client exists; the answer is about the OLD session. Once a sign-in starts a new session, only answers about the new
// one may decide anything, and a sign-in's own answers are never evidence about a session.
describe("R2: a client that inherits stale cookies, then signs in", () => {
  afterEach(() => vi.unstubAllGlobals());
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const NEW_USER = { id: "0f8fad5b-d9cb-469f-a165-70867728950e", aud: "authenticated", email: "a@example.test" };
  const err = (status: number, code: string): Reply => ({ status, body: { code, msg: code } });
  /** A client with `cookies` (stale or none) whose own startup refresh has settled, as a route would see it. */
  const setup = async (stale: boolean, script: (s: ReturnType<typeof fakeSupabase>) => void) => {
    const server = fakeSupabase();
    script(server);
    vi.stubGlobal("fetch", server.fetch);
    const cookies = stale ? await signedInCookies(-10) : [];
    const supabase = buildServerClient(SUPABASE_URL, "sb_publishable_test", { getAll: () => cookies, set: () => {} }, { https: false, deadline: AbortSignal.timeout(1500) });
    await pause(30);
    return { server, supabase };
  };
  const signIn = (supabase: SupabaseClient) => supabase.auth.signInWithPassword({ email: "a@example.test", password: "correct horse" });

  it("the old session's refresh_token_not_found does NOT sign out the new session (whose refresh is merely unusable)", async () => {
    const { supabase } = await setup(true, (s) => {
      s.reply("refresh", err(400, "refresh_token_not_found"), { status: 200, body: {} }); // old session; then the new one's
      s.reply("password", { status: 200, body: sessionBody(-10) }); // a new session that already needs a refresh (clock skew)
    });
    expect((await signIn(supabase)).error).toBeNull();
    expect(await verifyUser(supabase)).toEqual({ status: "unavailable" });
    expect(callLogOf(supabase)?.calls.map((c) => [c.endpoint, c.code ?? c.status, c.session ?? false])).toEqual([
      ["refresh", "refresh_token_not_found", false],
      ["sign-in", 200, true],
      ["refresh", 200, false],
    ]);
  });

  it("the new session's OWN definitive answer still signs out (refresh_token_already_used on its refresh)", async () => {
    const { supabase } = await setup(true, (s) => {
      s.reply("refresh", err(400, "refresh_token_not_found"), err(400, "refresh_token_already_used"));
      s.reply("password", { status: 200, body: sessionBody(-10) });
    });
    expect((await signIn(supabase)).error).toBeNull();
    expect(await verifyUser(supabase)).toEqual({ status: "signed-out", code: "refresh_token_already_used" });
  });

  it("after a good sign-in, /user decides: ok, unavailable on 503, signed out on session_not_found", async () => {
    for (const [reply, expected] of [
      [{ status: 200, body: NEW_USER }, { status: "ok" }],
      [{ status: 503, body: {} }, { status: "unavailable" }],
      [err(403, "session_not_found"), { status: "signed-out", code: "session_not_found" }],
    ] as const) {
      const { supabase } = await setup(true, (s) => {
        s.reply("refresh", err(400, "refresh_token_not_found"));
        s.reply("password", { status: 200, body: sessionBody(3600) });
        s.reply("user", reply);
      });
      expect((await signIn(supabase)).error).toBeNull();
      expect(await verifyUser(supabase)).toMatchObject(expected);
      vi.unstubAllGlobals();
    }
  });

  it("a FAILED sign-in leaves the old session's definitive answer in force → signed out (refresh_token_not_found)", async () => {
    const { supabase } = await setup(true, (s) => {
      s.reply("refresh", err(400, "refresh_token_not_found"));
      s.reply("password", err(400, "invalid_credentials"));
    });
    expect((await signIn(supabase)).error?.code).toBe("invalid_credentials");
    expect(await verifyUser(supabase)).toEqual({ status: "signed-out", code: "refresh_token_not_found" });
  });

  it("a FAILED sign-in after the old session's refresh was only rate limited → unavailable (still unknown)", async () => {
    const { supabase } = await setup(true, (s) => {
      s.reply("refresh", err(429, "over_request_rate_limit"));
      s.reply("password", err(400, "invalid_credentials"));
    });
    await signIn(supabase);
    expect(await verifyUser(supabase)).toEqual({ status: "unavailable" });
  });

  it("no cookies, and the sign-in is refused or fails → signed out (session_missing), not 'unavailable'", async () => {
    for (const reply of [err(400, "invalid_credentials"), err(403, "user_banned"), err(429, "over_request_rate_limit"), "network" as const]) {
      const { supabase, server } = await setup(false, (s) => s.reply("password", reply));
      await signIn(supabase);
      expect(await verifyUser(supabase)).toEqual({ status: "signed-out", code: "session_missing" });
      expect(server.calls.map((c) => c.endpoint)).toEqual(["password"]); // nothing was asked about any session
      vi.unstubAllGlobals();
    }
  });
});
