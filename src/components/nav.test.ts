import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/exams", useRouter: () => ({ push: vi.fn() }) }));

const { MobileNav, Nav } = await import("./nav");

// On a phone the bottom bar is fixed to the foot of the screen. Rendered before the page, the keyboard reached its six
// links before the top bar and the page; it must come after them, in the order they are seen.
const layout = readFileSync(new URL("../app/(app)/layout.tsx", import.meta.url), "utf8");

describe("navigation", () => {
  it("renders the mobile bottom bar after the page, the top bar and the toasts", () => {
    const mobile = layout.indexOf("<MobileNav />");
    expect(mobile).toBeGreaterThan(-1);
    expect(mobile).toBeGreaterThan(layout.indexOf("</main>"));
    expect(mobile).toBeGreaterThan(layout.indexOf("<TopBar />"));
    expect(mobile).toBeGreaterThan(layout.indexOf("<Toaster />"));
  });

  it("keeps the desktop sidebar before the page, where it sits on screen", () => {
    expect(layout.indexOf("<Nav />")).toBeGreaterThan(-1);
    expect(layout.indexOf("<Nav />")).toBeLessThan(layout.indexOf("<main"));
  });

  it("the sidebar no longer carries the bottom bar", () => {
    const html = renderToStaticMarkup(createElement(Nav));
    expect(html.match(/<nav\b/g)).toHaveLength(1);
    expect(html).not.toMatch(/<nav[^>]*class="[^"]*\bbottom-0\b/);
  });

  it("the bottom bar is the phone's main navigation, hidden from md up, with the current page marked", () => {
    const html = renderToStaticMarkup(createElement(MobileNav));
    expect(html).toMatch(/^<nav[^>]*class="[^"]*\bmd:hidden\b[^"]*"[^>]*aria-label="Main"/);
    const links = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(links).toEqual(["/", "/subjects", "/chat", "/important", "/zero-prep", "/exams"]);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    const current = /<a [^>]*aria-current="page"[^>]*>/.exec(html)![0];
    expect(current).toContain('href="/exams"');
  });
});
