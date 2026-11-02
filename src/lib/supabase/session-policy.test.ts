import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { classifyAuthError, definitiveCode, sessionEvidence, type AuthCall } from "./session-policy";

// The one rule used by the middleware's refresh and by verifyUser in route handlers. Every expectation is written
// out here, never taken from the policy's own list, so removing or adding a code shows up as a failure.

const log = (...calls: AuthCall[]) => ({ calls });

describe("classifyAuthError: each definitive code, one by one", () => {
  const cases: [string, number][] = [
    ["refresh_token_not_found", 400],
    ["refresh_token_already_used", 400],
    ["session_expired", 403],
    ["session_not_found", 403],
    ["user_not_found", 404],
    ["user_banned", 403],
    ["bad_jwt", 401],
  ];
  for (const [code, status] of cases) {
    it(`${code} → definitive`, () => expect(classifyAuthError(new AuthApiError(code, status, code))).toBe("definitive"));
  }
});

describe("classifyAuthError: everything else is temporary", () => {
  const cases: [string, unknown][] = [
    ["429 over_request_rate_limit", new AuthApiError("slow down", 429, "over_request_rate_limit")],
    ["408 request_timeout", new AuthApiError("timeout", 408, "request_timeout")],
    ["500 unexpected_failure", new AuthApiError("boom", 500, "unexpected_failure")],
    ["400 validation_failed", new AuthApiError("bad input", 400, "validation_failed")],
    ["an unknown code", new AuthApiError("new", 400, "some_new_code_supabase_adds_later")],
    ["an error without a code", new AuthApiError("no code", 403, undefined as unknown as string)],
    ["a network failure", new AuthRetryableFetchError("fetch failed", 0)],
    ["an unreadable answer", new AuthUnknownError("Unexpected token <", new Error("html"))],
    ["a plain Error", new Error("anything")],
    ["null", null],
  ];
  for (const [why, error] of cases) it(`${why} → temporary`, () => expect(classifyAuthError(error)).toBe("temporary"));
});

describe("classifyAuthError: a missing session is judged on the request's whole record", () => {
  const missing = new AuthSessionMissingError();
  it("definitive when Supabase answered session_not_found, whenever in the request", () => {
    expect(classifyAuthError(missing, log({ endpoint: "user", status: 403, code: "session_not_found" }))).toBe("definitive");
    // …even if a later call (e.g. a retry or another check) answered something else:
    expect(classifyAuthError(missing, log({ endpoint: "refresh", status: 403, code: "session_not_found" }, { endpoint: "user", status: 0 }))).toBe("definitive");
  });
  it("temporary when the client asked and nothing said the session is gone", () => {
    expect(classifyAuthError(missing, log({ endpoint: "refresh", status: 200 }))).toBe("temporary"); // /token 200 without a session
    expect(classifyAuthError(missing, log({ endpoint: "refresh", status: 0 }))).toBe("temporary"); // network / deadline
    expect(classifyAuthError(missing, log({ endpoint: "refresh", status: 429, code: "over_request_rate_limit" }))).toBe("temporary");
  });
  it("no-session when this client asked nothing at all (there was no session to ask about)", () => {
    expect(classifyAuthError(missing, log())).toBe("no-session");
    expect(classifyAuthError(missing)).toBe("no-session");
  });

  // R1: auth-js removes the session after ANY definitive refresh answer, then reports only a missing session. Each
  // code is written out (not taken from DEFINITIVE_CODES) so a code dropped from the policy shows up here.
  const recorded: [string, number][] = [
    ["refresh_token_not_found", 400],
    ["refresh_token_already_used", 400],
    ["session_expired", 403],
    ["session_not_found", 403],
    ["user_not_found", 404],
    ["user_banned", 403],
    ["bad_jwt", 401],
  ];
  for (const [code, status] of recorded) {
    it(`R1: a missing session after /token answered ${code} → definitive, reported as ${code}`, () => {
      const l = log({ endpoint: "refresh", status, code });
      expect(classifyAuthError(missing, l)).toBe("definitive");
      expect(definitiveCode(missing, l)).toBe(code);
    });
  }
  it("R1: the definitive answer counts wherever it sits in the record (after retries, before a failed call)", () => {
    const l = log({ endpoint: "refresh", status: 503 }, { endpoint: "refresh", status: 400, code: "refresh_token_not_found" }, { endpoint: "user", status: 0 });
    expect(classifyAuthError(missing, l)).toBe("definitive");
    expect(definitiveCode(missing, l)).toBe("refresh_token_not_found");
  });
  it("R1: a record of only temporary or unknown answers stays temporary", () => {
    const l = log(
      { endpoint: "refresh", status: 0 },
      { endpoint: "refresh", status: 408, code: "request_timeout" },
      { endpoint: "refresh", status: 429, code: "over_request_rate_limit" },
      { endpoint: "refresh", status: 500, code: "unexpected_failure" },
      { endpoint: "refresh", status: 400, code: "validation_failed" },
      { endpoint: "refresh", status: 400, code: "some_new_code_supabase_adds_later" },
      { endpoint: "refresh", status: 403 },
      { endpoint: "refresh", status: 200 },
    );
    expect(classifyAuthError(missing, l)).toBe("temporary");
    expect(definitiveCode(missing, l)).toBeNull();
  });
  it("R1: the record never overrides a temporary error that isn't a missing session", () => {
    // A request whose refresh said "gone" but whose current failure is a 429 / network error stays temporary: only a
    // missing-session error is judged on the record.
    const l = log({ endpoint: "refresh", status: 400, code: "refresh_token_not_found" });
    expect(classifyAuthError(new AuthApiError("slow down", 429, "over_request_rate_limit"), l)).toBe("temporary");
    expect(classifyAuthError(new AuthRetryableFetchError("fetch failed", 0), l)).toBe("temporary");
    expect(classifyAuthError(new Error("anything"), l)).toBe("temporary");
    expect(definitiveCode(new AuthRetryableFetchError("fetch failed", 0), l)).toBeNull();
  });
});

describe("definitiveCode: the error's own code wins", () => {
  it("returns the code a definitive error carries, ignoring the record", () => {
    expect(definitiveCode(new AuthApiError("gone", 400, "refresh_token_not_found"), log({ endpoint: "user", status: 403, code: "user_banned" }))).toBe("refresh_token_not_found");
  });
  it("null for a non-definitive error or a missing session with no evidence", () => {
    expect(definitiveCode(new AuthApiError("x", 400, "validation_failed"))).toBeNull();
    expect(definitiveCode(new AuthSessionMissingError(), log())).toBeNull();
    expect(definitiveCode(null)).toBeNull();
  });
});

// R2: only refresh and /user answers about the session the client holds NOW are evidence.
describe("sessionEvidence / classifyAuthError: sign-in answers are never evidence (R2)", () => {
  const missing = new AuthSessionMissingError();
  const signedIn: AuthCall = { endpoint: "sign-in", status: 200, session: true };
  it("a refused sign-in, with no session before it → no-session (not 'temporary', not definitive)", () => {
    expect(classifyAuthError(missing, log({ endpoint: "sign-in", status: 400, code: "invalid_credentials" }))).toBe("no-session");
    expect(classifyAuthError(missing, log({ endpoint: "sign-in", status: 0 }))).toBe("no-session"); // network on sign-in
    expect(classifyAuthError(missing, log({ endpoint: "sign-in", status: 429, code: "over_request_rate_limit" }))).toBe("no-session");
  });
  it("a definitive-looking code on a sign-in answer is not evidence about any session", () => {
    const l = log({ endpoint: "sign-in", status: 403, code: "user_banned" }, { endpoint: "sign-in", status: 403, code: "session_not_found" });
    expect(definitiveCode(missing, l)).toBeNull();
    expect(classifyAuthError(missing, l)).toBe("no-session");
  });
  it("a stale session's definitive refresh answer stops counting once a sign-in started a new session", () => {
    const l = log({ endpoint: "refresh", status: 400, code: "refresh_token_not_found" }, signedIn, { endpoint: "refresh", status: 200 });
    expect(sessionEvidence(l)).toEqual([{ endpoint: "refresh", status: 200 }]);
    expect(definitiveCode(missing, l)).toBeNull();
    expect(classifyAuthError(missing, l)).toBe("temporary"); // the NEW session's refresh was unusable: unknown
  });
  it("…and with nothing asked since the new session started → no-session", () => {
    expect(classifyAuthError(missing, log({ endpoint: "refresh", status: 400, code: "refresh_token_not_found" }, signedIn))).toBe("no-session");
  });
  it("a stale session's definitive answer still counts when the sign-in after it FAILED (no new session)", () => {
    const l = log({ endpoint: "refresh", status: 400, code: "refresh_token_not_found" }, { endpoint: "sign-in", status: 400, code: "invalid_credentials" });
    expect(classifyAuthError(missing, l)).toBe("definitive");
    expect(definitiveCode(missing, l)).toBe("refresh_token_not_found");
  });
  it("the NEW session's own definitive answers count", () => {
    const l = log({ endpoint: "refresh", status: 503 }, signedIn, { endpoint: "user", status: 403, code: "session_not_found" });
    expect(definitiveCode(missing, l)).toBe("session_not_found");
  });
  it("only the LAST session-starting sign-in matters", () => {
    const l = log(signedIn, { endpoint: "refresh", status: 400, code: "refresh_token_already_used" }, signedIn, { endpoint: "user", status: 0 });
    expect(definitiveCode(missing, l)).toBeNull();
    expect(classifyAuthError(missing, l)).toBe("temporary");
  });
  it("an error that carries its own definitive code is unaffected by the log", () => {
    expect(classifyAuthError(new AuthApiError("gone", 400, "refresh_token_not_found"), log(signedIn))).toBe("definitive");
  });
});
