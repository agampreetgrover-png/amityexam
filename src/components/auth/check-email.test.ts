import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

const { CheckEmailScreen, resendCooldown, resendLabel, secondsLeft, RESEND_COOLDOWN_SECONDS } = await import("./screens/check-email");
const { forgotOutcome } = await import("./screens/forgot-password");

const text = (html: string) => html.replace(/<[^>]+>/g, " ");
const CLAIMS_BACKUP = /\b(backed up|backs up|synced|syncs|syncing|saved to the cloud|in the cloud|cloud backup)\b/i;

describe("check-email screen markup", () => {
  // On the server there's no sessionStorage, so the address is unknown and the screen asks for it.
  const html = renderToStaticMarkup(createElement(CheckEmailScreen));

  it("asks for the address when it doesn't know it, with a label and email autocomplete", () => {
    expect(html).toMatch(/<label for="[^"]+"[^>]*>Email<\/label>/);
    expect(html).toMatch(/autocomplete="email"/i);
  });

  it("says the link works on any device and to check spam", () => {
    expect(html).toContain("any device");
    expect(html).toContain("spam");
  });

  it("offers sign-in and starting again", () => {
    expect(html).toContain("Opened the link already?");
    expect(html).toContain('href="/login"');
    expect(html).toContain("Wrong address?");
    expect(html).toContain('href="/signup"');
  });

  it("has a polite status for the wait, and holds the form while checking", () => {
    expect(html).toMatch(/role="status"[^>]*aria-live="polite"/);
    expect(html).toMatch(/<fieldset[^>]*disabled/);
    expect(html).toContain("Send the link again");
  });

  it("claims no backup or sync", () => {
    expect(text(html)).not.toMatch(CLAIMS_BACKUP);
  });
});

describe("resend cooldown", () => {
  it("waits a minute after a send", () => {
    expect(RESEND_COOLDOWN_SECONDS).toBe(60);
    expect(resendCooldown("sent")).toBe(60);
  });

  it("waits as long as the server asks when rate limited", () => {
    expect(resendCooldown({ ok: false, code: "rate_limited", retryAfter: 42 })).toBe(42);
    expect(resendCooldown({ ok: false, code: "rate_limited" })).toBe(60);
  });

  it("doesn't wait after a transport failure", () => {
    expect(resendCooldown({ ok: false, code: "offline" })).toBe(0);
    expect(resendCooldown({ ok: false, code: "unavailable" })).toBe(0);
  });

  it("treats a resend answer generically: a refusal that could reveal an account reads as sent", () => {
    expect(resendCooldown(forgotOutcome({ ok: false, code: "invalid_credentials" }))).toBe(60);
    expect(resendCooldown(forgotOutcome({ ok: true }))).toBe(60);
  });

  it("counts down in whole seconds and labels the button", () => {
    expect(secondsLeft(10_000, 0)).toBe(10);
    expect(secondsLeft(10_000, 9_001)).toBe(1);
    expect(secondsLeft(10_000, 12_000)).toBe(0);
    expect(resendLabel(42)).toBe("Send again in 42s");
    expect(resendLabel(0)).toBe("Send the link again");
  });
});
