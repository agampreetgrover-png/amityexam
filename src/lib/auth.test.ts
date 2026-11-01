import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createServerClient } from "@supabase/ssr";
import { fakeSupabase, signedInCookies, SUPABASE_URL, type Reply } from "@/test/fake-supabase";
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

  it("an answer with no user in it → signed out", async () => {
    expect(await verifyUser(client({ data: { user: null }, error: null }))).toMatchObject({ status: "signed-out" });
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
describe("verifyUser with the real Supabase client", () => {
  const verify = async (reply: Reply) => {
    const server = fakeSupabase();
    server.reply("user", reply);
    const cookies = await signedInCookies(3600);
    const supabase = createServerClient(SUPABASE_URL, "sb_publishable_test", {
      cookies: { getAll: () => cookies, setAll: () => {} },
      global: { fetch: server.fetch },
    });
    return verifyUser(supabase);
  };

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
});
