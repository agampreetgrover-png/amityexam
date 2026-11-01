import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { planSwitch, type SwitchPlan } from "@/lib/auth/profile-switch";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("next=/subjects"),
}));

const { SwitchConfirmation, SwitchScreen, switchCopy } = await import("./screens/switch");

const ME = "0b6c1f8e-4d2a-4c3b-9e1f-7a8b9c0d1e2f";
const OTHER = "9f8e7d6c-5b4a-4321-8fed-cba987654321";
const me = { id: ME, email: "riya@amity.edu" };

type ConfirmPlan = Extract<SwitchPlan, { kind: "confirm" }>;
const confirmFrom = (from: ConfirmPlan["from"], email: string | null = me.email): ConfirmPlan => ({ kind: "confirm", from, to: { userId: ME, email } });

/** The visible words only, one string. */
const text = (html: string) => html.replace(/<wbr\/?>/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");

describe("what /switch plans to do", () => {
  it("asks before opening the account when Local Mode is open", () => {
    expect(planSwitch({ kind: "local" }, me)).toEqual(confirmFrom({ kind: "local" }));
  });

  it("does nothing to confirm when that account is already open (even with a differently cased id)", () => {
    expect(planSwitch({ kind: "user", userId: ME }, { ...me, id: ME.toUpperCase() })).toEqual({ kind: "already-open", userId: ME });
  });

  it("asks before replacing another account's data, or an unreadable profile", () => {
    expect(planSwitch({ kind: "user", userId: OTHER }, me)).toEqual(confirmFrom({ kind: "user", userId: OTHER }));
    expect(planSwitch({ kind: "unknown" }, me)).toEqual(confirmFrom({ kind: "unknown" }));
  });

  it("with nobody verified there is nothing to open, and it never picks Local Mode by itself", () => {
    for (const current of [{ kind: "local" }, { kind: "user", userId: OTHER }, { kind: "unknown" }] as const) {
      expect(planSwitch(current, null)).toEqual({ kind: "no-account" });
    }
  });
});

describe("switchCopy", () => {
  it("from Local Mode: names both sides and offers to stay", () => {
    const c = switchCopy(confirmFrom({ kind: "local" }));
    expect(c.from).toEqual({ icon: "local", name: "Local Mode", detail: "Data kept in this browser without an account" });
    expect(c.to).toEqual({ icon: "account", name: "riya@amity.edu", detail: "Starts empty on this device if it's new" });
    expect(c.primaryLabel).toBe("Open this account's data");
    expect(c.secondary).toEqual({ kind: "stay-local", label: "Stay in Local Mode" });
    expect(c.lead).toContain("riya@amity.edu");
  });

  it("from another account: says its data stays closed, and Local Mode has to be chosen", () => {
    const c = switchCopy(confirmFrom({ kind: "user", userId: OTHER }));
    expect(c.from).toEqual({ icon: "account", name: "Another account", detail: "Its data stays on this device, closed" });
    expect(c.secondary).toEqual({ kind: "use-local", label: "Use Local Mode instead" });
  });

  it("from an unreadable profile: says so, and Local Mode has to be chosen", () => {
    const c = switchCopy(confirmFrom({ kind: "unknown" }));
    expect(c.from).toEqual({ icon: "unknown", name: "Unknown profile", detail: "This browser's profile setting couldn't be read" });
    expect(c.secondary.label).toBe("Use Local Mode instead");
  });

  it("without an email: falls back to 'this account'", () => {
    const c = switchCopy(confirmFrom({ kind: "local" }, null));
    expect(c.primaryLabel).toBe("Open this account's data");
    expect(c.to.name).toBe("This account");
    expect(c.lead).toMatch(/^This account is signed in/);
  });
});

describe("the confirmation screen", () => {
  const fromLocal = renderToStaticMarkup(createElement(SwitchConfirmation, { plan: confirmFrom({ kind: "local" }), next: "/subjects" }));
  const fromOther = renderToStaticMarkup(createElement(SwitchConfirmation, { plan: confirmFrom({ kind: "user", userId: OTHER }), next: "/" }));

  it("asks a question and names both profiles, each in a labelled section", () => {
    expect(fromLocal).toContain("Open your account&#x27;s data?");
    expect(fromLocal).toMatch(/<section aria-labelledby="switch-from"[^>]*>\s*<h2 id="switch-from"[^>]*>Open now<\/h2>/i);
    expect(fromLocal).toMatch(/<section aria-labelledby="switch-to"[^>]*>\s*<h2 id="switch-to"[^>]*>Will open<\/h2>/i);
    const words = text(fromLocal);
    expect(words).toMatch(/Open now Local Mode Data kept in this browser without an account/);
    expect(words).toMatch(/Will open riya@amity\.edu Starts empty on this device if it's new/);
  });

  it("says plainly that nothing is uploaded or merged and there is no sync", () => {
    const words = text(fromLocal);
    expect(words).toContain("Nothing is copied or uploaded");
    expect(words).toContain("never moves or merges your Local Mode data into the account");
    expect(words).toContain("There's no backup or sync yet");
  });

  it("offers an explicit choice: open the account, stay in Local Mode, or another account", () => {
    expect(fromLocal).toMatch(/<button[^>]*>.*Open this account&#x27;s data.*<\/button>/);
    expect(fromLocal).toMatch(/<a [^>]*href="\/"[^>]*>Stay in Local Mode<\/a>/);
    expect(fromLocal).toMatch(/href="\/login\?next=%2Fsubjects"[^>]*>Sign in with a different account</);
    expect(fromLocal).not.toContain("Use Local Mode instead");
  });

  it("from another account: Local Mode is a button to press, not a link to /", () => {
    expect(text(fromOther)).toContain("Another account Its data stays on this device, closed");
    expect(fromOther).toMatch(/<button[^>]*>Use Local Mode instead<\/button>/);
    expect(fromOther).not.toContain("Stay in Local Mode");
  });

  it("hides the decorative icons from screen readers", () => {
    for (const svg of fromLocal.match(/<svg[^>]*>/g) ?? []) expect(svg).toMatch(/aria-hidden="true"/i);
  });

  it("claims no backup or sync anywhere", () => {
    for (const html of [fromLocal, fromOther]) {
      for (const sentence of text(html).split(/[.!?]\s/)) {
        if (/backup|backed up|\bsync|cloud/i.test(sentence)) expect(sentence).toMatch(/\bno\b|n't|\bnot\b|never/i);
      }
    }
  });
});

describe("/switch before the server has answered", () => {
  // Server render only: effects (the session check, reading localStorage) don't run here. What happens after load
  // is covered by scripts/auth-ui-check.mjs in a real browser.
  it("shows a heading and a quiet status line, and no button that could switch", () => {
    const html = renderToStaticMarkup(createElement(SwitchScreen));
    expect(html).toContain("<h1");
    expect(html).toContain("Checking your sign-in");
    expect(html).toMatch(/role="status"/);
    expect(html).not.toContain("<button");
  });
});
