import { describe, expect, it } from "vitest";
import { stripFence } from "./json";

describe("stripFence", () => {
  it("removes a json fence, with or without the language", () => {
    expect(stripFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFence('```JSON {"a":1}```')).toBe('{"a":1}');
    expect(stripFence('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFence('  {"a":1}  ')).toBe('{"a":1}');
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
