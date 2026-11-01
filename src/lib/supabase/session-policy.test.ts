import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { classifyAuthError, type AuthCall } from "./session-policy";

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
    expect(classifyAuthError(missing, log({ endpoint: "token", status: 403, code: "session_not_found" }, { endpoint: "user", status: 0 }))).toBe("definitive");
  });
  it("temporary when the client asked and nothing said the session is gone", () => {
    expect(classifyAuthError(missing, log({ endpoint: "token", status: 200 }))).toBe("temporary"); // /token 200 without a session
    expect(classifyAuthError(missing, log({ endpoint: "token", status: 0 }))).toBe("temporary"); // network / deadline
    expect(classifyAuthError(missing, log({ endpoint: "token", status: 429, code: "over_request_rate_limit" }))).toBe("temporary");
  });
  it("no-session when this client asked nothing at all (there was no session to ask about)", () => {
    expect(classifyAuthError(missing, log())).toBe("no-session");
    expect(classifyAuthError(missing)).toBe("no-session");
  });
});
