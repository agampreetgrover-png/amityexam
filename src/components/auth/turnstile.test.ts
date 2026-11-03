import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

const { captchaOrFailure } = await import("./turnstile");
const { SignInScreen } = await import("./screens/sign-in");
const { SignUpScreen } = await import("./screens/sign-up");
const { ForgotPasswordScreen } = await import("./screens/forgot-password");

// H1: every sign-in, sign-up and email form carries a Turnstile widget for its own action; the server refuses a
// request without a token, so the form doesn't even send one (it says the check is needed instead).

describe("the forms' CAPTCHA", () => {
  it("no token yet: the form reports captcha_failed itself, without a request", () => {
    expect(captchaOrFailure(null)).toEqual({ ok: false, code: "captcha_failed" });
    expect(captchaOrFailure("")).toEqual({ ok: false, code: "captcha_failed" });
    expect(captchaOrFailure("tok")).toEqual({ token: "tok" });
  });

  it("each form places the widget for its own action (the server checks the token was made for it)", () => {
    expect(renderToStaticMarkup(createElement(SignInScreen))).toContain('data-captcha-action="login"');
    expect(renderToStaticMarkup(createElement(SignUpScreen))).toContain('data-captcha-action="signup"');
    expect(renderToStaticMarkup(createElement(ForgotPasswordScreen))).toContain('data-captcha-action="forgot"');
  });
});
