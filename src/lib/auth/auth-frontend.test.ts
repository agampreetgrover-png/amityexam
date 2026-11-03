import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSession, setFetchForTests, signIn, signOut, signUp, toResult, updatePassword, verifyEmailLink } from "./client";
import { ACCOUNT_FACTS, errorMessage, SIGNED_OUT_NOTICE, STATE_COPY } from "./copy";
import { passwordBytes, passwordChars, passwordProblem, passwordProgress } from "./password-policy";
import { planSwitch, readCurrentProfile, openProfile } from "./profile-switch";
import { signedOutState, signInNotice } from "./copy";
import { confirmError, emailError, validateNewPassword, validateSignIn, validateSignUp } from "./validate";
import { forgetPendingEmail, readPendingEmail, rememberPendingEmail } from "./pending-email";

const A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("password policy: 10 characters minimum, 72 bytes maximum, nothing else", () => {
  it("counts characters as a person does", () => {
    expect(passwordChars("éééééééééé")).toBe(10);
    expect(passwordChars("😀".repeat(10))).toBe(10);
  });
  it("accepts 10 plain characters with no uppercase, digit or symbol", () => {
    expect(passwordProblem("abcdefghij")).toBeNull();
    expect(passwordProblem("aaaaaaaaaa")).toBeNull();
  });
  it("refuses 9 characters and empty", () => {
    expect(passwordProblem("abcdefghi")).toBe("too-short");
    expect(passwordProblem("")).toBe("empty");
  });
  it("allows exactly 72 bytes and refuses 73", () => {
    expect(passwordProblem("a".repeat(72))).toBeNull();
    expect(passwordProblem("a".repeat(73))).toBe("too-long");
    // 18 emoji are 72 bytes; 19 are 76.
    expect(passwordBytes("😀".repeat(18))).toBe(72);
    expect(passwordProblem("😀".repeat(18))).toBeNull();
    expect(passwordProblem("😀".repeat(19))).toBe("too-long");
  });
  it("tells the student where they stand as they type", () => {
    expect(passwordProgress("").met).toBe(false);
    expect(passwordProgress("abc").text).toBe("7 more characters to go.");
    expect(passwordProgress("abcdefghi").text).toBe("1 more character to go.");
    expect(passwordProgress("abcdefghij")).toEqual({ met: true, text: "Long enough." });
    expect(passwordProgress("a".repeat(80)).met).toBe(false);
  });
});

describe("form validation", () => {
  it("email", () => {
    expect(emailError("")).toBeTruthy();
    expect(emailError("name")).toBeTruthy();
    expect(emailError("name@uni")).toBeTruthy();
    expect(emailError(" name@amity.edu ")).toBeUndefined();
    expect(emailError(`${"a".repeat(250)}@x.co`)).toBeTruthy();
  });
  it("sign-in needs a password but doesn't apply the new-password rules (old passwords may predate them)", () => {
    expect(validateSignIn({ email: "a@b.co", password: "" })).toHaveProperty("password");
    expect(validateSignIn({ email: "a@b.co", password: "short" })).toEqual({});
  });
  it("sign-up: mismatched passwords are reported on the confirm field", () => {
    expect(validateSignUp({ email: "a@b.co", password: "abcdefghij", confirm: "abcdefghik" })).toEqual({ confirm: "The passwords don't match." });
    expect(validateSignUp({ email: "a@b.co", password: "abcdefghij", confirm: "abcdefghij" })).toEqual({});
    expect(confirmError("x", "")).toBe("Type the password again.");
  });
  it("a too-short password is reported once, not again as a mismatch", () => {
    expect(validateNewPassword({ password: "short", confirm: "other" })).toEqual({ password: "Use at least 10 characters." });
  });
});

describe("API client: same-origin JSON, no storage, server answers passed on", () => {
  afterEach(() => {
    setFetchForTests(null);
    vi.unstubAllGlobals();
  });
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

  it("posts JSON to a same-origin /auth path with cookies, and nothing else", async () => {
    const f = vi.fn(async () => json(200, { userId: A, email: "a@b.co" }));
    setFetchForTests(f as unknown as typeof fetch);
    const r = await signIn({ email: "a@b.co", password: "pw", captchaToken: "tok" });
    expect(r).toEqual({ ok: true, userId: A, email: "a@b.co" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/auth/login");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ email: "a@b.co", password: "pw", captchaToken: "tok" });
  });

  it("never touches localStorage, sessionStorage or document.cookie", async () => {
    const touched: string[] = [];
    const trap = (name: string) => new Proxy({}, { get: (_t, p) => (touched.push(`${name}.${String(p)}`), vi.fn()) });
    vi.stubGlobal("localStorage", trap("localStorage"));
    vi.stubGlobal("sessionStorage", trap("sessionStorage"));
    vi.stubGlobal("document", { get cookie() { touched.push("cookie"); return ""; }, set cookie(_v: string) { touched.push("cookie="); } });
    setFetchForTests((async () => json(200, {})) as unknown as typeof fetch);
    await signUp({ email: "a@b.co", password: "abcdefghij", captchaToken: "tok" });
    await updatePassword({ password: "abcdefghij", expectedUserId: A });
    await signOut();
    expect(touched).toEqual([]);
  });

  it("a route that doesn't exist yet is 'not available', never success", async () => {
    expect(await toResult(new Response("<html>404</html>", { status: 404, headers: { "Content-Type": "text/html" } }))).toEqual({ ok: false, code: "not_available" });
    expect(await toResult(new Response("<html>ok</html>", { status: 200, headers: { "Content-Type": "text/html" } }))).toEqual({ ok: false, code: "not_available" });
  });

  it("maps the contract's error codes, Retry-After and the field", async () => {
    expect(await toResult(json(401, { error: { code: "invalid_credentials" } }))).toEqual({ ok: false, code: "invalid_credentials" });
    expect(await toResult(json(429, { error: { code: "rate_limited" } }, { "Retry-After": "90" }))).toEqual({ ok: false, code: "rate_limited", retryAfter: 90 });
    expect(await toResult(json(400, { error: { code: "invalid_input", field: "email" } }))).toEqual({ ok: false, code: "invalid_input", field: "email" });
    expect(await toResult(json(500, { error: { code: "made_up_code" } }))).toEqual({ ok: false, code: "unavailable" });
    expect(await toResult(new Response(null, { status: 429 }))).toEqual({ ok: false, code: "rate_limited" });
    expect(await toResult(new Response(null, { status: 403 }))).toEqual({ ok: false, code: "blocked" });
  });

  it("no answer at all is a network problem, never 'signed out'", async () => {
    setFetchForTests((async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch);
    expect(await getSession()).toEqual({ ok: false, code: "network" });
    expect(await verifyEmailLink({ tokenHash: "x", type: "signup" })).toEqual({ ok: false, code: "network" });
  });

  it("offline is reported without sending anything", async () => {
    const f = vi.fn();
    setFetchForTests(f as unknown as typeof fetch);
    vi.stubGlobal("navigator", { onLine: false });
    expect(await signIn({ email: "a@b.co", password: "x", captchaToken: "tok" })).toEqual({ ok: false, code: "offline" });
    expect(f).not.toHaveBeenCalled();
  });

  it("reads the session states, and treats a malformed answer as unknown rather than signed in", async () => {
    const answer = (body: unknown) => setFetchForTests((async () => json(200, body)) as unknown as typeof fetch);
    answer({ state: "disabled" });
    expect(await getSession()).toEqual({ ok: true, session: { state: "disabled" } });
    answer({ state: "signed-out", reason: "revoked" });
    expect(await getSession()).toEqual({ ok: true, session: { state: "signed-out", reason: "revoked" } });
    answer({ state: "verified", user: { id: A, email: "a@b.co", emailVerified: true }, verifiedAt: "2026-11-01T10:00:00Z" });
    expect(await getSession()).toMatchObject({ ok: true, session: { state: "verified", user: { id: A } } });
    answer({ state: "verified" });
    expect(await getSession()).toEqual({ ok: false, code: "unknown" });
  });
});

describe("profile switching never happens by itself", () => {
  const store = (v: string | null) => ({ getItem: () => v });
  it("reads the current profile, and calls unreadable storage unknown (not Local Mode)", () => {
    expect(readCurrentProfile(store(null))).toEqual({ kind: "local" });
    expect(readCurrentProfile(store(`u:${A}`))).toEqual({ kind: "user", userId: A });
    expect(readCurrentProfile(store("garbage"))).toEqual({ kind: "unknown" });
    expect(readCurrentProfile({ getItem: () => { throw new Error("blocked"); } })).toEqual({ kind: "unknown" });
    expect(readCurrentProfile(null)).toEqual({ kind: "unknown" });
  });
  it("asks before opening an account over Local Mode, another account or an unknown profile", () => {
    const to = { id: A, email: "a@b.co" };
    expect(planSwitch({ kind: "local" }, to)).toEqual({ kind: "confirm", from: { kind: "local" }, to: { userId: A, email: "a@b.co" } });
    expect(planSwitch({ kind: "user", userId: B }, to).kind).toBe("confirm");
    expect(planSwitch({ kind: "unknown" }, to).kind).toBe("confirm");
  });
  it("the same account is already open; nobody verified means nothing to open, not Local Mode", () => {
    expect(planSwitch({ kind: "user", userId: A }, { id: A.toUpperCase(), email: null })).toEqual({ kind: "already-open", userId: A });
    expect(planSwitch({ kind: "user", userId: A }, null)).toEqual({ kind: "no-account" });
    expect(planSwitch({ kind: "local" }, null)).toEqual({ kind: "no-account" });
  });
  it("openProfile stores exactly the chosen profile, then loads the app fresh", () => {
    const m = new Map<string, string>();
    const go = vi.fn();
    const ok = openProfile({ kind: "user", userId: A }, { storage: { setItem: (k, v) => void m.set(k, v), getItem: (k) => m.get(k) ?? null }, go }, "/subjects");
    expect(ok).toBe(true);
    expect(m.get("amityexams:profile")).toBe(`u:${A}`);
    expect(go).toHaveBeenCalledWith("/subjects");
  });
  it("if the choice can't be saved it goes nowhere (no silent fall back to what was stored before)", () => {
    const go = vi.fn();
    expect(openProfile({ kind: "user", userId: A }, { storage: { setItem: () => { throw new Error("QuotaExceeded"); }, getItem: () => "local" }, go })).toBe(false);
    expect(openProfile({ kind: "user", userId: A }, { storage: { setItem: () => {}, getItem: () => "local" }, go })).toBe(false);
    expect(openProfile({ kind: "user", userId: A }, { storage: null, go })).toBe(false);
    expect(go).not.toHaveBeenCalled();
  });
  it("the server's sign-out reason picks the screen; someone who never signed in isn't told they were signed out", () => {
    expect(signedOutState("deleted", true)).toBe("account-unavailable");
    expect(signedOutState("banned", false)).toBe("account-unavailable");
    expect(signedOutState("expired", true)).toBe("session-expired");
    expect(signedOutState("revoked", true)).toBe("signed-out");
    expect(signedOutState("none", true)).toBe("signed-out");
    expect(signedOutState("none", false)).toBe("not-signed-in");
    expect(signInNotice("verify", "expired")).toBe("verify");
    expect(signInNotice(null, "revoked")).toBe("revoked");
    expect(signInNotice("nonsense", "none")).toBeNull();
  });
});

describe("pending email (sessionStorage, email only)", () => {
  it("round-trips and forgets", () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    rememberPendingEmail("a@b.co", s);
    expect(readPendingEmail(s)).toBe("a@b.co");
    forgetPendingEmail(s);
    expect(readPendingEmail(s)).toBeNull();
  });
});

describe("wording", () => {
  it("every error code has a specific message", () => {
    for (const code of ["invalid_credentials", "email_not_confirmed", "rate_limited", "unavailable", "offline", "network", "link_expired", "link_invalid", "not_available"] as const) {
      expect(errorMessage(code)).not.toBe(errorMessage("unknown"));
    }
    expect(errorMessage("rate_limited", 45)).toContain("45 seconds");
    expect(errorMessage("rate_limited", 125)).toContain("3 minutes");
  });

  it("nothing in the account screens claims backup, sync or cloud storage is available", () => {
    const texts = [
      ...ACCOUNT_FACTS.flatMap((f) => [f.title, f.body]),
      ...Object.values(SIGNED_OUT_NOTICE).flatMap((n) => [n.title, n.body]),
      ...Object.values(STATE_COPY).flatMap((n) => [n.title, n.body]),
    ];
    // Also every string literal in the screens and components.
    const dir = join(process.cwd(), "src", "components", "auth");
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    // Code comments are for developers, not students: only text that can reach the screen is checked.
    const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    for (const f of walk(dir).filter((p) => /\.tsx$/.test(p))) texts.push(stripComments(readFileSync(f, "utf8")));
    const claims = /\b(synced|syncing|backed up|saved to the cloud|stored in the cloud|cloud backup is on|automatically backed)\b/i;
    for (const t of texts) expect(t).not.toMatch(claims);
  });
});
