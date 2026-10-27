import { describe, expect, it } from "vitest";
import { safeNext } from "./unlock-page";

describe("safeNext", () => {
  it("keeps paths inside the app", () => {
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/subjects/view?id=3&tab=pyqs")).toBe("/subjects/view?id=3&tab=pyqs");
    expect(safeNext("/zero-prep#top")).toBe("/zero-prep#top");
  });

  it("sends anything that could leave the app to /", () => {
    for (const v of [
      "//evil.example",
      "/\\evil.example",
      "/%09/evil.example", // as a form field the %09 arrives decoded, see below
      "/\t/evil.example",
      "/\n/evil.example",
      "/\r\n/evil.example",
      "/ /evil.example".replace(" ", "\t"),
      "/.//evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "evil.example",
      "",
    ]) {
      const out = safeNext(v);
      expect(out.startsWith("/") && !out.startsWith("//") && new URL(out, "http://app.invalid").host).toBe("app.invalid");
    }
    expect(safeNext("/\t/evil.example")).toBe("/");
    expect(safeNext("/.//evil.example")).toBe("/");
  });

  it("rejects non-strings and very long values", () => {
    expect(safeNext(undefined)).toBe("/");
    expect(safeNext(42)).toBe("/");
    expect(safeNext(`/${"a".repeat(3000)}`)).toBe("/");
  });
});
