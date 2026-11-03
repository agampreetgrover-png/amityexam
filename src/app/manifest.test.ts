import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

// The installed app's colour (title bar, splash screen) is the icon's indigo, which is the app's filled-button colour.
const icons = readFileSync(new URL("../../scripts/make-icons.mjs", import.meta.url), "utf8");
const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

describe("web app manifest", () => {
  it("uses the app icon's colour as its theme colour", () => {
    const iconFill = /<rect[^>]*fill="(#[0-9a-f]{6})"/i.exec(icons)?.[1];
    expect(iconFill).toBeDefined();
    expect(manifest().theme_color?.toLowerCase()).toBe(iconFill!.toLowerCase());
  });

  it("and that colour is --accent-solid", () => {
    const accent = /--accent-solid:\s*(#[0-9a-f]{6})\s*;/i.exec(css)?.[1];
    expect(accent).toBeDefined();
    expect(manifest().theme_color?.toLowerCase()).toBe(accent!.toLowerCase());
  });
});
