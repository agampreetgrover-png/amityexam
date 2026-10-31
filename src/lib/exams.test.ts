import { describe, expect, it } from "vitest";
import { byWhen, EXAM_TYPES, examTypeLabel, isUrgent, urgency, urgentMark } from "./exams";
import type { ExamType } from "./types";

describe("urgency", () => {
  it.each([
    [-30, "past"],
    [-1, "past"],
    [0, "critical"],
    [6, "critical"],
    [7, "soon"],
    [14, "soon"],
    [15, "later"],
    [100, "later"],
  ] as const)("%i days -> %s", (days, expected) => {
    expect(urgency(days)).toBe(expected);
  });
});

describe("isUrgent", () => {
  it.each([
    [-1, false],
    [0, true],
    [6, true],
    [7, true],
    [14, true],
    [15, false],
    [100, false],
  ] as const)("%i days -> %s", (days, expected) => {
    expect(isUrgent(days)).toBe(expected);
  });
});

describe("urgentMark", () => {
  it.each([
    [-1, undefined],
    [0, "mark mark-critical"],
    [6, "mark mark-critical"],
    [7, "mark"],
    [14, "mark"],
    [15, undefined],
  ] as const)("%i days -> %s", (days, expected) => {
    expect(urgentMark(days)).toBe(expected);
  });

  it("gives a mark exactly when the countdown is urgent", () => {
    for (let d = -5; d <= 30; d++) expect(urgentMark(d) !== undefined).toBe(isUrgent(d));
  });
});

describe("byWhen", () => {
  const sort = (xs: { date: string; time?: string }[]) => [...xs].sort(byWhen);

  it("orders by date first", () => {
    expect(sort([{ date: "2026-11-10", time: "09:00" }, { date: "2026-11-03", time: "14:00" }])).toEqual([
      { date: "2026-11-03", time: "14:00" },
      { date: "2026-11-10", time: "09:00" },
    ]);
  });

  it("orders by time within the same day", () => {
    expect(sort([{ date: "2026-11-03", time: "14:00" }, { date: "2026-11-03", time: "09:30" }])).toEqual([
      { date: "2026-11-03", time: "09:30" },
      { date: "2026-11-03", time: "14:00" },
    ]);
  });

  it("puts untimed exams after timed ones on the same day", () => {
    expect(sort([{ date: "2026-11-03" }, { date: "2026-11-03", time: "23:59" }, { date: "2026-11-03", time: "" }])).toEqual([
      { date: "2026-11-03", time: "23:59" },
      { date: "2026-11-03" },
      { date: "2026-11-03", time: "" },
    ]);
  });

  it("returns 0 for the same slot", () => {
    expect(byWhen({ date: "2026-11-03", time: "09:00" }, { date: "2026-11-03", time: "09:00" })).toBe(0);
  });
});

describe("examTypeLabel", () => {
  it("labels every known type", () => {
    for (const { value, label } of EXAM_TYPES) expect(examTypeLabel(value)).toBe(label);
    expect(examTypeLabel("mid-term")).toBe("Mid-term");
  });

  it("falls back to the raw value for an unknown type", () => {
    expect(examTypeLabel("quiz" as ExamType)).toBe("quiz");
  });
});
