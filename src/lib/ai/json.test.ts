import { describe, expect, it } from "vitest";
import { stripFence } from "./json";

describe("stripFence", () => {
  it("removes a json fence, with or without the language", () => {
    expect(stripFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFence('```JSON {"a":1}```')).toBe('{"a":1}');
    expect(stripFence('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFence('  {"a":1}  ')).toBe('{"a":1}');
  });

  it("finds the JSON inside a reply that talks around it", () => {
    expect(stripFence('Here you go:\n```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFence('Sure! {"a":{"b":2}} Hope this helps.')).toBe('{"a":{"b":2}}');
    expect(stripFence("Questions: [1,2,3]. Done")).toBe("[1,2,3]");
    expect(stripFence("no json here")).toBe("no json here");
  });

  it("stays fast on a long reply with no JSON in it", () => {
    const evil = `x${" {".repeat(100_000)}`;
    const t = performance.now();
    stripFence(evil);
    expect(performance.now() - t).toBeLessThan(200);
  });

  it("leaves fences inside the JSON alone", () => {
    expect(stripFence('{"md":"```code```"}')).toBe('{"md":"```code```"}');
  });

  it("stays fast on long runs of whitespace", () => {
    const evil = `{${" ".repeat(200_000)}x${" ".repeat(200_000)}\`\`\`x`;
    const t = performance.now();
    stripFence(evil);
    expect(performance.now() - t).toBeLessThan(200);
  });
});
