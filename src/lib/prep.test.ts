import { describe, expect, it } from "vitest";
import { filterPrep, formatMins, prepRows, quickWin, sortPrep, type PrepFilters } from "./prep";
import type { PyqQuestion, Subject, Topic, TopicPrep } from "./types";

const subject = (id: number, name: string): Subject => ({ id, name, color: "#000", createdAt: 0 });
const prep = (level: 0 | 1 | 2, mins: number, importance: 1 | 2 | 3 = 2): TopicPrep => ({ level, mins, importance, at: 0 });
const topic = (id: number, title: string, p?: TopicPrep, subjectId = 1): Topic => ({
  id, subjectId, unitId: 1, title, confidence: 3, status: "not-started", prep: p,
});
const asked = (id: number, topicId: number, subjectId = 1): PyqQuestion => ({ id, subjectId, materialId: 1, number: `Q${id}`, text: "q", topicId, year: 2024 });

const all: PrepFilters = { prep: "light", asked: "any", importance: "any", subjectId: "all" };

describe("zero prep rows", () => {
  const subjects = [subject(1, "DBMS"), subject(2, "OS")];
  const topics = [
    topic(1, "Keys", prep(0, 15)),
    topic(2, "Normalisation", prep(2, 90, 3)),
    topic(3, "ER diagrams", prep(1, 30, 3)),
    topic(4, "Not rated yet"),
    topic(5, "Deadlock", prep(0, 20, 3), 2),
  ];
  const qs = [asked(1, 1), asked(2, 1), asked(3, 3), asked(4, 5)];
  const rows = prepRows(topics, subjects, qs);

  it("leaves out topics the AI hasn't rated", () => {
    expect(rows.map((r) => r.topic.id)).toEqual([1, 2, 3, 5]);
  });

  it("counts how often each topic was asked", () => {
    expect(rows.find((r) => r.topic.id === 1)?.count).toBe(2);
    expect(rows.find((r) => r.topic.id === 2)?.count).toBe(0);
  });

  it("filters by prep, frequency, importance and subject", () => {
    expect(filterPrep(rows, { ...all, prep: "zero" }).map((r) => r.topic.id)).toEqual([1, 5]);
    expect(filterPrep(rows, all).map((r) => r.topic.id)).toEqual([1, 3, 5]); // light includes zero, never groundwork
    expect(filterPrep(rows, { ...all, asked: "often" }).map((r) => r.topic.id)).toEqual([1]);
    expect(filterPrep(rows, { ...all, importance: "high" }).map((r) => r.topic.id)).toEqual([3, 5]);
    expect(filterPrep(rows, { ...all, subjectId: 2 }).map((r) => r.topic.id)).toEqual([5]);
  });

  it("sorts by quick wins, times asked or time", () => {
    const light = filterPrep(rows, all);
    expect(sortPrep(light, "asked")[0].topic.id).toBe(1);
    expect(sortPrep(light, "quick").map((r) => r.prep.mins)).toEqual([15, 20, 30]);
  });
});

describe("quick win score", () => {
  it("rewards being asked and being quick, and discounts groundwork", () => {
    expect(quickWin(prep(0, 20), 3, false)).toBeGreaterThan(quickWin(prep(0, 20), 0, false));
    expect(quickWin(prep(0, 15), 1, false)).toBeGreaterThan(quickWin(prep(0, 60), 1, false));
    expect(quickWin(prep(0, 20), 1, false)).toBeGreaterThan(quickWin(prep(1, 20), 1, false));
  });
});

describe("minutes", () => {
  it("reads as minutes, then hours", () => {
    expect(formatMins(45)).toBe("45 min");
    expect(formatMins(60)).toBe("1 h");
    expect(formatMins(150)).toBe("2 h 30 min");
  });
});
