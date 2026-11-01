import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { validateNewPassword } from "@/lib/auth/validate";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

const { ResetPasswordScreen, LinkExpired, PasswordChanged, resetFailureView } = await import("./screens/reset-password");

const text = (html: string) => html.replace(/<[^>]+>/g, " ");
const CLAIMS_BACKUP = /\b(backed up|backs up|synced|syncs|syncing|saved to the cloud|in the cloud|cloud backup)\b/i;

describe("reset-password screen markup", () => {
  const html = renderToStaticMarkup(createElement(ResetPasswordScreen));

  it("labels both fields and marks them as new passwords", () => {
    expect(html).toMatch(/<label for="[^"]+"[^>]*>New password<\/label>/);
    expect(html).toMatch(/<label for="[^"]+"[^>]*>Confirm new password<\/label>/);
    expect(html.match(/autocomplete="new-password"/gi)).toHaveLength(2);
    expect(html).not.toMatch(/onpaste/i);
  });

  it("states the requirement once and holds the form until a signed-in account is confirmed", () => {
    expect(html.match(/Use at least 10 characters/g)).toHaveLength(1);
    expect(html).toMatch(/<fieldset[^>]*disabled/);
    expect(html).toContain("Save new password");
  });

  it("claims no backup or sync", () => {
    expect(text(html)).not.toMatch(CLAIMS_BACKUP);
  });
});

describe("reset-password answers", () => {
  it("treats a missing session as an expired link", () => {
    expect(resetFailureView({ ok: false, code: "session_missing" })).toBe("expired");
  });

  it("puts a refused password on the field", () => {
    expect(resetFailureView({ ok: false, code: "weak_password" })).toBe("password");
    expect(resetFailureView({ ok: false, code: "same_password" })).toBe("password");
  });

  it("shows everything else as a notice", () => {
    expect(resetFailureView({ ok: false, code: "user_mismatch" })).toBe("notice");
    expect(resetFailureView({ ok: false, code: "rate_limited", retryAfter: 9 })).toBe("notice");
    expect(resetFailureView({ ok: false, code: "network" })).toBe("notice");
  });

  it("validates a mismatch on the confirm field", () => {
    expect(validateNewPassword({ password: "a long new password", confirm: "a long new passw0rd" })).toEqual({ confirm: "The passwords don't match." });
  });

  it("offers a new link and sign-in when the link has expired", () => {
    const html = renderToStaticMarkup(createElement(LinkExpired));
    expect(html).toContain("This link has expired");
    expect(html).toContain('href="/forgot-password"');
    expect(html).toContain("Ask for a new link");
    expect(html).toContain('href="/login"');
  });

  it("confirms the change and opens the account only when asked", () => {
    const html = renderToStaticMarkup(createElement(PasswordChanged));
    expect(html).toContain("Password changed");
    expect(html).toContain("Other devices signed in to this account have been signed out.");
    expect(html).toMatch(/<a [^>]*href="\/switch"[^>]*>Open your account<\/a>/);
    expect(text(html)).not.toMatch(CLAIMS_BACKUP);
  });
});
