import { describe, expect, it } from "vitest";
import { normalizeMathDelimiters as norm } from "./math-delimiters";

describe("normalizeMathDelimiters", () => {
  it("turns \\( … \\) into inline $ … $", () => {
    expect(norm("Speed is \\( v = d/t \\) here.")).toBe("Speed is $v = d/t$ here.");
  });

  it("turns a \\[ … \\] on its own lines into a display block", () => {
    expect(norm("Then\n\\[\nE = mc^2\n\\]\ndone")).toBe("Then\n$$\nE = mc^2\n$$\ndone");
    expect(norm("\\[ a^2 + b^2 = c^2 \\]")).toBe("$$\na^2 + b^2 = c^2\n$$");
  });

  it("keeps a display block inside its list item or quote", () => {
    expect(norm("1. Area:\n   \\[ \\pi r^2 \\]")).toBe("1. Area:\n   $$\n   \\pi r^2\n   $$");
    expect(norm("> \\[x\\]")).toBe("> $$\n> x\n> $$");
  });

  it("keeps a mid-sentence \\[ … \\] in the line", () => {
    expect(norm("| a | \\[x^2\\] |")).toBe("| a | $$x^2$$ |");
  });

  it("leaves code alone", () => {
    const fenced = "```latex\n\\( x \\)\n\\[ y \\]\n```";
    expect(norm(fenced)).toBe(fenced);
    expect(norm(`${fenced}\n\\(z\\)`)).toBe(`${fenced}\n$z$`);
    expect(norm("Write `\\(x\\)` for \\(x\\)")).toBe("Write `\\(x\\)` for $x$");
    // Still streaming: an unclosed fence runs to the end.
    expect(norm("```\n\\(x\\)")).toBe("```\n\\(x\\)");
  });

  it("leaves TeX line breaks and existing dollars alone", () => {
    const tex = "$$\n\\begin{aligned} a \\\\[2pt] b \\end{aligned}\n$$";
    expect(norm(tex)).toBe(tex);
    expect(norm("costs \\( \\$5 \\)")).toBe("costs \\( \\$5 \\)");
  });

  it("leaves an unclosed or empty delimiter, or one across a blank line", () => {
    expect(norm("\\( x")).toBe("\\( x");
    expect(norm("\\( \\)")).toBe("\\( \\)");
    expect(norm("\\[ a\n\nb \\]")).toBe("\\[ a\n\nb \\]");
  });

  it("returns text without these delimiters unchanged", () => {
    const md = "Plain $x$ and $$y$$ with `code` and \\* stars.";
    expect(norm(md)).toBe(md);
  });
  it("stays fast on text full of unclosed delimiters or backtick runs", () => {
    // Model output is untrusted. These took seconds with lazy regexes that retried from every opener.
    const inputs = ["\\[".repeat(40_000), "\\(".repeat(40_000), Array.from({ length: 400 }, (_, i) => "`".repeat(i + 1)).join("a")];
    const start = performance.now();
    for (const s of inputs) norm(s);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("pairs each opener with the nearest close, skipping escaped ones", () => {
    expect(norm("a \\( x \\) b \\( y \\) c")).toBe("a $x$ b $y$ c");
    expect(norm("so \\[ a \\\\[2pt] b \\] here")).toBe("so $$a \\\\[2pt] b$$ here");
    expect(norm("`\\( x \\)` and \\( y \\)")).toBe("`\\( x \\)` and $y$");
  });

  it("opens a one-line $$ … $$ on its own line into a display block", () => {
    expect(norm("grows:\n$$\\sum i = x$$\nso")).toBe("grows:\n$$\n\\sum i = x\n$$\nso");
    expect(norm("- item\n  $$a+b$$")).toBe("- item\n  $$\n  a+b\n  $$");
  });
});
