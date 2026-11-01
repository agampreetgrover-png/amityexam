import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("reason=expired"),
}));

const { SignInScreen } = await import("./screens/sign-in");

describe("sign-in screen markup", () => {
  const html = renderToStaticMarkup(createElement(SignInScreen));

  it("labels every field and ties the password toggle to its field", () => {
    expect(html).toMatch(/<label for="([^"]+)"[^>]*>Email<\/label>/);
    expect(html).toMatch(/<label for="([^"]+)"[^>]*>Password<\/label>/);
    const pw = /<label for="([^"]+)"[^>]*>Password<\/label>/.exec(html)![1];
    expect(html).toContain(`aria-controls="${pw}"`);
    expect(html).toContain('aria-label="Show password"');
    expect(html).toContain('aria-pressed="false"');
  });

  it("lets password managers fill it: current-password, username, and no blocked paste", () => {
    expect(html).toMatch(/autocomplete="current-password"/i);
    expect(html).toMatch(/autocomplete="username"/i);
    expect(html).not.toMatch(/onpaste/i);
  });

  it("explains why the student was sent here (?reason=expired)", () => {
    expect(html).toContain("Your session expired");
  });

  it("holds the form until the server has said whether accounts are on", () => {
    expect(html).toMatch(/<fieldset[^>]*disabled/);
  });

  it("offers Local Mode as a button the student presses, not a redirect", () => {
    expect(html).toContain("Continue without an account");
  });
});
