import { describe, expect, it } from "vitest";
import { review } from "./srs";

const NEW_SRS = { ease: 2.5, interval: 0, reps: 0 };

describe("SM-2 review", () => {
  it("grows intervals 1 → 6 → ~15 on good answers", () => {
    const a = review(NEW_SRS, 4, "2026-11-01");
    expect(a.interval).toBe(1);
    expect(a.due).toBe("2026-11-02");
    const b = review(a, 4, a.due);
    expect(b.interval).toBe(6);
    const c = review(b, 4, b.due);
    expect(c.interval).toBe(15);
  });

  it("resets on a failed answer and lowers ease (floored at 1.3)", () => {
    let s = review(review(NEW_SRS, 5, "2026-11-01"), 5, "2026-11-02");
    s = review(s, 1, "2026-11-08");
    expect(s.reps).toBe(0);
    expect(s.interval).toBe(1);
    for (let i = 0; i < 20; i++) s = review(s, 0, "2026-11-08");
    expect(s.ease).toBe(1.3);
  });
});
