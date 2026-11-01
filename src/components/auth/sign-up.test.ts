import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { validateSignUp } from "@/lib/auth/validate";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

const { SignUpScreen } = await import("./screens/sign-up");

const text = (html: string) => html.replace(/<[^>]+>/g, " ");
/** Words that would promise more than a sign-in-only account. "No backup or sync yet" is fine; "backed up" isn't. */
const CLAIMS_BACKUP = /\b(backed up|backs up|synced|syncs|syncing|saved to the cloud|in the cloud|cloud backup)\b/i;

describe("sign-up screen markup", () => {
  const html = renderToStaticMarkup(createElement(SignUpScreen));

  it("labels every field", () => {
    expect(html).toMatch(/<label for="[^"]+"[^>]*>Email<\/label>/);
    expect(html).toMatch(/<label for="[^"]+"[^>]*>Password<\/label>/);
    expect(html).toMatch(/<label for="[^"]+"[^>]*>Confirm password<\/label>/);
  });

  it("lets password managers fill it: username plus new-password on both password fields, no blocked paste", () => {
    expect(html).toMatch(/autocomplete="username"/i);
    expect(html.match(/autocomplete="new-password"/gi)).toHaveLength(2);
    expect(html).not.toMatch(/onpaste/i);
  });

  it("states the password requirement once, under the first password field only", () => {
    expect(html.match(/Use at least 10 characters/g)).toHaveLength(1);
  });

  it("holds the form until the server has said whether accounts are on", () => {
    expect(html).toMatch(/<fieldset[^>]*disabled/);
  });

  it("says what an account is, and links to sign in", () => {
    expect(html).toContain("How accounts work right now");
    expect(html).toContain("Already have an account?");
    expect(html).toContain('href="/login"');
    expect(html).toContain("Create account");
  });

  it("claims no backup or sync", () => {
    expect(text(html)).not.toMatch(CLAIMS_BACKUP);
  });
});

describe("sign-up validation", () => {
  it("reports a mismatch on the confirm field once the password is acceptable", () => {
    expect(validateSignUp({ email: "a@b.co", password: "long enough pw", confirm: "long enough pW" })).toEqual({ confirm: "The passwords don't match." });
  });

  it("reports a short password on the password field, not as a mismatch", () => {
    expect(validateSignUp({ email: "a@b.co", password: "short", confirm: "other" })).toEqual({ password: "Use at least 10 characters." });
  });

  it("accepts a matching password with no composition rules", () => {
    expect(validateSignUp({ email: "a@b.co", password: "all lowercase words", confirm: "all lowercase words" })).toEqual({});
  });
});
