import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));

const { ConfirmScreen, ConfirmView, EmailConfirmed, SwitchQuestion, confirmOutcome, parseConfirmLink, readLinkFromLocation, switchCheck } = await import("./screens/confirm");

const TOKEN = "pkce_8f2a1c9e0b7d4e6fa3c5b9d1e2f4a6c8";

/** The screen once the browser has read the link from the address bar. */
function render(query: string) {
  search = query;
  return renderToStaticMarkup(createElement(ConfirmView, { link: parseConfirmLink(query) }));
}

/** The visible words only, one string. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseConfirmLink", () => {
  it.each(["signup", "email", "recovery"] as const)("accepts a %s link", (type) => {
    expect(parseConfirmLink(`token_hash=${TOKEN}&type=${type}`)).toEqual({ ok: true, tokenHash: TOKEN, type });
    expect(parseConfirmLink(new URLSearchParams({ token_hash: "abc-DEF_123", type }))).toEqual({ ok: true, tokenHash: "abc-DEF_123", type });
  });

  it("accepts a leading ? and a 512-character token", () => {
    const long = "a".repeat(512);
    expect(parseConfirmLink(`?type=signup&token_hash=${long}`)).toEqual({ ok: true, tokenHash: long, type: "signup" });
  });

  it("rejects a missing or empty token, keeping the type to offer the right new link", () => {
    expect(parseConfirmLink("type=recovery")).toEqual({ ok: false, type: "recovery" });
    expect(parseConfirmLink("type=signup&token_hash=")).toEqual({ ok: false, type: "signup" });
  });

  it("rejects a missing or unknown type", () => {
    expect(parseConfirmLink(`token_hash=${TOKEN}`)).toEqual({ ok: false, type: null });
    expect(parseConfirmLink(`token_hash=${TOKEN}&type=magiclink`)).toEqual({ ok: false, type: null });
    expect(parseConfirmLink(`token_hash=${TOKEN}&type=SIGNUP`)).toEqual({ ok: false, type: null });
  });

  it("rejects illegal characters and over-long tokens", () => {
    for (const bad of ["abc def", "abc.def", "abc/def", "abc%00", "<script>", "abc=", "é"]) {
      expect(parseConfirmLink(new URLSearchParams({ token_hash: bad, type: "signup" })).ok).toBe(false);
    }
    expect(parseConfirmLink(`type=signup&token_hash=${"a".repeat(513)}`).ok).toBe(false);
  });
});

describe("confirmOutcome", () => {
  it("sends a used reset link on to choosing a new password, and confirms the rest in place", () => {
    expect(confirmOutcome({ ok: true, type: "recovery" }, "recovery")).toEqual({ kind: "reset-password" });
    expect(confirmOutcome({ ok: true }, "recovery")).toEqual({ kind: "reset-password" });
    expect(confirmOutcome({ ok: true, type: "signup" }, "signup")).toEqual({ kind: "confirmed" });
    expect(confirmOutcome({ ok: true, type: "email" }, "email")).toEqual({ kind: "confirmed" });
  });

  it("ends the page for a dead link or accounts being off", () => {
    expect(confirmOutcome({ ok: false, code: "link_expired" }, "signup")).toEqual({ kind: "expired" });
    expect(confirmOutcome({ ok: false, code: "link_invalid" }, "signup")).toEqual({ kind: "invalid" });
    expect(confirmOutcome({ ok: false, code: "not_available" }, "signup")).toEqual({ kind: "accounts-off" });
    expect(confirmOutcome({ ok: false, code: "disabled" }, "recovery")).toEqual({ kind: "accounts-off" });
  });

  it("keeps the button for problems worth retrying, with the shared wording", () => {
    for (const code of ["offline", "network", "unavailable", "rate_limited", "blocked", "unknown"] as const) {
      expect(confirmOutcome({ ok: false, code }, "signup").kind).toBe("retry");
    }
    expect(confirmOutcome({ ok: false, code: "rate_limited", retryAfter: 90 }, "signup")).toEqual({
      kind: "retry",
      message: "Too many attempts. Try again in 2 minutes.",
    });
  });
});

describe("reading the link", () => {
  it("prefers the fragment (never sent to the server), and falls back to the query", () => {
    expect(readLinkFromLocation({ hash: `#token_hash=${TOKEN}&type=signup`, search: "" })).toEqual({ ok: true, tokenHash: TOKEN, type: "signup" });
    expect(readLinkFromLocation({ hash: "", search: `?token_hash=${TOKEN}&type=recovery` })).toEqual({ ok: true, tokenHash: TOKEN, type: "recovery" });
    expect(readLinkFromLocation({ hash: "#section", search: `?token_hash=${TOKEN}&type=email` })).toMatchObject({ ok: true, type: "email" });
    expect(readLinkFromLocation({ hash: "", search: "" })).toEqual({ ok: false, type: null });
  });

  it("the server-rendered page holds no token and no confirm button: the link is read only in the browser", () => {
    search = `token_hash=${TOKEN}&type=signup`;
    const html = renderToStaticMarkup(createElement(ConfirmScreen));
    expect(html).not.toContain(TOKEN);
    expect(html).not.toMatch(/type="submit"/);
    expect(html).toContain("Opening your link");
  });

  it("names the confirmed address, so a link for someone else's account is noticed", () => {
    expect(text(renderToStaticMarkup(createElement(EmailConfirmed, { email: "riya@amity.edu" })))).toContain("riya@amity.edu is confirmed");
  });
});

describe("confirm screen markup", () => {
  // "Nothing is sent when the page opens" is checked in a real browser (scripts/auth-ui-check.mjs); a server render runs no effects.
  it("a valid link shows one confirm button and never renders the token", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const html = render(`token_hash=${TOKEN}&type=signup`);
    expect(html).toContain("<h1");
    expect(html).toContain("Confirm your email");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Confirm email<\/button>/);
    expect(html).toContain("This extra step stops email security scanners from using up your link.");
    expect(html).not.toContain(TOKEN);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a reset link asks to continue to a new password", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const html = render(`token_hash=${TOKEN}&type=recovery`);
    expect(html).toContain("Reset your password");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Continue to set a new password<\/button>/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a broken link says so and offers sign-in and the right way to get a new link", () => {
    const signup = render("token_hash=bad%20token&type=signup");
    expect(signup).toContain("This link doesn&#x27;t work");
    expect(signup).toMatch(/href="\/login"/);
    expect(signup).toMatch(/href="\/check-email"[^>]*>Send a new link</);
    expect(signup).not.toMatch(/type="submit"/);

    const recovery = render("type=recovery");
    expect(recovery).toMatch(/href="\/forgot-password"[^>]*>Ask for a new link</);
    const unknown = render(`token_hash=${TOKEN}`);
    expect(unknown).toMatch(/href="\/forgot-password"/);
  });

  it("claims no backup or sync anywhere", () => {
    for (const q of [`token_hash=${TOKEN}&type=signup`, `token_hash=${TOKEN}&type=recovery`, "type=signup"]) {
      for (const sentence of text(render(q)).split(/[.!?]\s/)) {
        if (/backup|backed up|\bsync|cloud/i.test(sentence)) expect(sentence).toMatch(/\bno\b|n't|\bnot\b|never/i);
      }
    }
  });
});

// M3: a link someone else sent must never silently replace the account this browser is signed in to.
describe("switching accounts through an emailed link", () => {
  const A = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const verified = { status: "ready", session: { state: "verified", user: { id: A, email: "a@uni.example", emailVerified: true }, verifiedAt: "" } } as const;

  it("asks first whenever an account is signed in here, naming it", () => {
    expect(switchCheck(verified, false)).toEqual({ kind: "ask", email: "a@uni.example", userId: A });
  });

  it("asks when the server says a session is present, even if the session check couldn't tell", () => {
    expect(switchCheck({ status: "unavailable" }, true)).toEqual({ kind: "ask", email: null, userId: null });
    expect(switchCheck({ status: "offline" }, true)).toMatchObject({ kind: "ask" });
  });

  it("waits for the session check before the link can be used; uses it directly when nobody is signed in", () => {
    expect(switchCheck({ status: "checking" }, false)).toEqual({ kind: "wait" });
    expect(switchCheck({ status: "ready", session: { state: "signed-out", reason: "none" } }, false)).toEqual({ kind: "none" });
    expect(switchCheck({ status: "off" }, false)).toEqual({ kind: "none" });
    // Can't tell (service down): the link is tried without consent, and the server answers switch_required if needed.
    expect(switchCheck({ status: "unavailable" }, false)).toEqual({ kind: "none" });
  });

  it("the link button stays disabled until the session check has answered", () => {
    expect(render(`token_hash=${TOKEN}&type=signup`)).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  });

  const form = { formRef: { current: null }, onSubmit: async () => {}, busy: false, phase: "idle" as const };
  it("the question names the signed-in account, says what continuing does, and needs an explicit press", () => {
    const html = renderToStaticMarkup(createElement(SwitchQuestion, { email: "a@uni.example", recovery: false, form, failure: null }));
    const t = text(html);
    expect(t).toContain("Switch accounts?");
    expect(t).toContain("signed in to a@uni.example");
    expect(t).toMatch(/may belong to a different account/);
    expect(t).toContain("signs a@uni.example out on this device");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Sign out and continue<\/button>/);
    expect(html).toMatch(/href="\/"[^>]*>Stay signed in</);
  });

  it("for a reset link it says a new password will be chosen for the link's account; without a known email it still asks", () => {
    const t = text(renderToStaticMarkup(createElement(SwitchQuestion, { email: null, recovery: true, form, failure: null })));
    expect(t).toContain("signed in to an account");
    expect(t).toMatch(/choose a new password for the account the link was sent to/);
  });

  it("once a link has signed in, the confirmed address is named, with a way to sign out if it isn't yours", () => {
    const t = text(renderToStaticMarkup(createElement(EmailConfirmed, { email: "b@elsewhere.example" })));
    expect(t).toContain("b@elsewhere.example is confirmed");
    expect(t).toContain("Not your address? Sign out now");
  });
});
