import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AuthErrorCode } from "@/lib/auth/client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

const { ForgotPasswordScreen, ForgotSent, forgotOutcome } = await import("./screens/forgot-password");

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const CLAIMS_BACKUP = /\b(backed up|backs up|synced|syncs|syncing|saved to the cloud|in the cloud|cloud backup)\b/i;

describe("forgot-password screen markup", () => {
  const html = renderToStaticMarkup(createElement(ForgotPasswordScreen));

  it("labels the email field and lets password managers fill it", () => {
    expect(html).toMatch(/<label for="[^"]+"[^>]*>Email<\/label>/);
    expect(html).toMatch(/autocomplete="username"/i);
  });

  it("holds the form while checking, names the action, and links back to sign in", () => {
    expect(html).toMatch(/<fieldset[^>]*disabled/);
    expect(html).toContain("Send link");
    expect(html).toContain('href="/login"');
  });

  it("claims no backup or sync", () => {
    expect(text(html)).not.toMatch(CLAIMS_BACKUP);
  });
});

describe("forgot-password answer", () => {
  it("reads as sent for success and for anything that could reveal whether an account exists", () => {
    const sent: AuthErrorCode[] = ["invalid_credentials", "unknown", "invalid_input", "email_not_confirmed", "user_mismatch"];
    expect(forgotOutcome({ ok: true })).toBe("sent");
    for (const code of sent) expect(forgotOutcome({ ok: false, code })).toBe("sent");
  });

  it("passes on transport and availability problems, and a failed security check (checked before the address)", () => {
    const shown: AuthErrorCode[] = ["offline", "network", "rate_limited", "unavailable", "disabled", "not_available", "blocked", "captcha_failed"];
    for (const code of shown) expect(forgotOutcome({ ok: false, code })).toEqual({ ok: false, code });
    expect(forgotOutcome({ ok: false, code: "rate_limited", retryAfter: 30 })).toEqual({ ok: false, code: "rate_limited", retryAfter: 30 });
  });

  it("shows one generic message naming the typed address", () => {
    const html = renderToStaticMarkup(createElement(ForgotSent, { email: "name@x.com" }));
    const t = text(html);
    expect(t).toMatch(/If an account uses name@x\.com ?, we(&#x27;|')ve sent it a link to reset the password\./);
    expect(t).toMatch(/Didn(&#x27;|')t get it\? Check spam, or try again in a few minutes\./);
    expect(t).not.toMatch(/no account|not found|doesn.t exist|isn.t registered/i);
    expect(html).toContain('href="/login"');
    expect(html).toMatch(/role="status"/);
  });
});
