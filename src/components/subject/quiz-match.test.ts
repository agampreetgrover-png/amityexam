import { describe, expect, it } from "vitest";
import { matchOption } from "./quiz-match";

const opts = ["Queue", "Stack", "Linked list", "Binary tree"];

describe("matchOption", () => {
  it("matches exact text, ignoring case and spacing", () => {
    expect(matchOption("  stack ", opts)).toBe("Stack");
  });

  it("maps letter answers onto options", () => {
    expect(matchOption("B", opts)).toBe("Stack");
    expect(matchOption("(c)", opts)).toBe("Linked list");
    expect(matchOption("Option D", opts)).toBe("Binary tree");
    expect(matchOption("b) Stack", opts)).toBe("Stack");
  });

  it("does not read a leading article as a letter", () => {
    expect(matchOption("a stack", opts)).toBe("Stack");
  });

  it("handles a full-sentence answer containing exactly one option", () => {
    expect(matchOption("The answer is a binary tree.", opts)).toBe("Binary tree");
  });

  it("returns null when nothing fits or it is ambiguous", () => {
    expect(matchOption("Hash map", opts)).toBeNull();
    expect(matchOption("E", opts)).toBeNull();
  });
});
