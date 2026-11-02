import { afterEach, describe, expect, it, vi } from "vitest";
import { issueRecoveryMarker, RECOVERY_WINDOW_S, recoveryCookieOptions, recoveryMarkerValid } from "./recovery-marker";

// The proof /auth/verify gives a recovery link's session, and the only thing /auth/update-password accepts.

const SECRET = "s".repeat(40);
const USER = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SESSION = "c6e8f1a2-0000-4000-8000-000000000001";
const NOW = 1_800_000_000;

afterEach(() => vi.unstubAllEnvs());

describe("recovery marker", () => {
  it("is valid for exactly the user and session it was issued for, within the window", () => {
    const m = issueRecoveryMarker(SECRET, USER, SESSION, NOW)!;
    expect(recoveryMarkerValid(m, SECRET, USER, SESSION, NOW)).toBe(true);
    expect(recoveryMarkerValid(m, SECRET, USER, SESSION, NOW + RECOVERY_WINDOW_S - 1)).toBe(true);
  });
  it("expires after the window", () => {
    const m = issueRecoveryMarker(SECRET, USER, SESSION, NOW)!;
    expect(recoveryMarkerValid(m, SECRET, USER, SESSION, NOW + RECOVERY_WINDOW_S + 1)).toBe(false);
  });
  it("can't be moved to another session or another account", () => {
    const m = issueRecoveryMarker(SECRET, USER, SESSION, NOW)!;
    expect(recoveryMarkerValid(m, SECRET, USER, "another-session", NOW)).toBe(false);
    expect(recoveryMarkerValid(m, SECRET, "another-user", SESSION, NOW)).toBe(false);
  });
  it("can't be forged, extended or reused under another secret", () => {
    const m = issueRecoveryMarker(SECRET, USER, SESSION, NOW)!;
    const [exp, sig] = m.split(".");
    expect(recoveryMarkerValid(`${Number(exp) + 600}.${sig}`, SECRET, USER, SESSION, NOW)).toBe(false); // longer life
    expect(recoveryMarkerValid(`${exp}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`, SECRET, USER, SESSION, NOW)).toBe(false);
    expect(recoveryMarkerValid(m, "t".repeat(40), USER, SESSION, NOW)).toBe(false);
    // An expiry far in the future can't be valid even with a matching MAC (it was never issued that way).
    for (const v of ["", "abc", `${NOW}.`, `.${sig}`, `${exp}.${sig}.x`, "9".repeat(13) + "." + sig, undefined]) {
      expect(recoveryMarkerValid(v, SECRET, USER, SESSION, NOW)).toBe(false);
    }
  });
  it("needs a user and a session id to be issued or accepted", () => {
    expect(issueRecoveryMarker(SECRET, "", SESSION, NOW)).toBeNull();
    expect(issueRecoveryMarker(SECRET, USER, "", NOW)).toBeNull();
    const m = issueRecoveryMarker(SECRET, USER, SESSION, NOW)!;
    expect(recoveryMarkerValid(m, SECRET, USER, "", NOW)).toBe(false);
  });
  it("on Vercel without a 32+ character secret: nothing is issued or accepted (fail closed)", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(issueRecoveryMarker(null, USER, SESSION, NOW)).toBeNull();
    expect(issueRecoveryMarker("short", USER, SESSION, NOW)).toBeNull();
    const m = issueRecoveryMarker(SECRET, USER, SESSION, NOW)!;
    expect(recoveryMarkerValid(m, SECRET, USER, SESSION, NOW)).toBe(true);
    expect(recoveryMarkerValid(m, null, USER, SESSION, NOW)).toBe(false);
  });
  it("on this computer without a secret: a per-process key stands in (one process issues and checks)", () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    const m = issueRecoveryMarker(null, USER, SESSION, NOW)!;
    expect(recoveryMarkerValid(m, null, USER, SESSION, NOW)).toBe(true);
    expect(recoveryMarkerValid(m, SECRET, USER, SESSION, NOW)).toBe(false);
  });
  it("its cookie is HttpOnly, SameSite=Strict, sent only to /auth, Secure on https", () => {
    expect(recoveryCookieOptions(true)).toEqual({ httpOnly: true, secure: true, sameSite: "strict", path: "/auth", maxAge: RECOVERY_WINDOW_S });
    expect(recoveryCookieOptions(false, 0)).toMatchObject({ secure: false, maxAge: 0 });
  });
});
