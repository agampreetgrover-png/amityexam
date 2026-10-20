import { describe, expect, it } from "vitest";
import { generatePlan, topicMinutes } from "./planner";
import type { Exam, StudySession, Topic } from "./types";

const settings = { dailyMinutes: 120, offDays: [], revisionDays: 1, sessionMins: 60 };

const topic = (id: number, subjectId = 1, over: Partial<Topic> = {}): Topic => ({
  id, subjectId, unitId: 1, title: `T${id}`, difficulty: 3, confidence: 3,
  status: "not-started", ease: 2.5, interval: 0, reps: 0, ...over,
});
const exam = (id: number, subjectId: number, date: string): Exam => ({
  id, subjectId, type: "end-term", date, topicIds: [], checklist: [],
});

const studyMins = (s: StudySession[], topicId: number) =>
  s.filter((x) => x.topicId === topicId).reduce((a, x) => a + x.plannedMins, 0);

describe("generatePlan", () => {
  it("schedules every topic before its exam and reserves revision day", () => {
    const topics = [topic(1), topic(2), topic(3)];
    const { sessions, unscheduled } = generatePlan({
      start: "2026-11-01", exams: [exam(1, 1, "2026-11-10")], topics, done: [], settings,
    });
    expect(unscheduled).toEqual([]);
    for (const t of topics) expect(studyMins(sessions, t.id!)).toBe(topicMinutes(t));
    expect(sessions.filter((s) => s.kind === "study").every((s) => s.date < "2026-11-09")).toBe(true);
    expect(sessions.some((s) => s.kind === "revision" && s.date === "2026-11-09")).toBe(true);
  });

  it("never exceeds daily capacity and skips off days", () => {
    const topics = Array.from({ length: 6 }, (_, i) => topic(i + 1));
    const { sessions } = generatePlan({
      start: "2026-11-01", exams: [exam(1, 1, "2026-11-20")], topics, done: [],
      settings: { ...settings, offDays: [0] }, // Sundays off; 2026-11-01 is a Sunday
    });
    const perDay = new Map<string, number>();
    for (const s of sessions) perDay.set(s.date, (perDay.get(s.date) ?? 0) + s.plannedMins);
    for (const m of perDay.values()) expect(m).toBeLessThanOrEqual(120);
    expect(sessions.some((s) => s.date === "2026-11-01" || s.date === "2026-11-08")).toBe(false);
  });

  it("reports topics that cannot fit (infeasible plan)", () => {
    const topics = Array.from({ length: 10 }, (_, i) => topic(i + 1, 1, { difficulty: 5, confidence: 1 }));
    const { unscheduled } = generatePlan({
      start: "2026-11-01", exams: [exam(1, 1, "2026-11-03")], topics, done: [], settings,
    });
    expect(unscheduled.length).toBeGreaterThan(0);
  });

  it("rebalances: re-planning after a missed day keeps all remaining work", () => {
    const topics = [topic(1), topic(2), topic(3)];
    const exams = [exam(1, 1, "2026-11-10")];
    const first = generatePlan({ start: "2026-11-01", exams, topics, done: [], settings });
    // Day 1 missed entirely, day 2 done.
    const done = first.sessions
      .filter((s) => s.date === "2026-11-02" && s.kind === "study")
      .map((s) => ({ ...s, done: true, actualMins: s.plannedMins }));
    const again = generatePlan({ start: "2026-11-03", exams, topics, done, settings });
    const total = (s: StudySession[]) => s.filter((x) => x.kind === "study").reduce((a, x) => a + x.plannedMins, 0);
    const doneTotal = done.reduce((a, x) => a + x.actualMins, 0);
    expect(total(again.sessions)).toBe(total(first.sessions) - doneTotal);
    expect(again.sessions.every((s) => s.date >= "2026-11-03")).toBe(true);
  });

  it("handles two exams on the same date without double-booking", () => {
    const topics = [topic(1, 1), topic(2, 1), topic(3, 2), topic(4, 2)];
    const { sessions, unscheduled } = generatePlan({
      start: "2026-11-01", exams: [exam(1, 1, "2026-11-08"), exam(2, 2, "2026-11-08")], topics, done: [], settings,
    });
    expect(unscheduled).toEqual([]);
    const rev = sessions.filter((s) => s.date === "2026-11-07");
    expect(rev.reduce((a, s) => a + s.plannedMins, 0)).toBeLessThanOrEqual(120);
    for (const t of topics) expect(studyMins(sessions, t.id!)).toBe(topicMinutes(t));
  });

  it("carries topics a too-close exam can't fit over to a later exam that covers them", () => {
    const topics = [topic(1), topic(2)];
    const mid = { ...exam(1, 1, "2026-11-01"), topicIds: [1, 2] }; // today: no study days left
    const end = exam(2, 1, "2026-11-20");
    const { sessions, unscheduled } = generatePlan({ start: "2026-11-01", exams: [mid, end], topics, done: [], settings });
    expect(unscheduled.map((u) => u.examId)).toEqual([1, 1]);
    for (const t of topics) expect(studyMins(sessions, t.id!)).toBe(topicMinutes(t));
  });

  it("does not double-plan a topic covered by two exams", () => {
    const topics = [topic(1)];
    const { sessions } = generatePlan({
      start: "2026-11-01", exams: [exam(1, 1, "2026-11-10"), exam(2, 1, "2026-11-20")], topics, done: [], settings,
    });
    expect(studyMins(sessions, 1)).toBe(topicMinutes(topics[0]));
  });

  it("terminates and stays sane with broken settings (0 block length, NaN hours)", () => {
    const topics = [topic(1), topic(2)];
    const exams = [exam(1, 1, "2026-11-10")];
    const zeroBlock = generatePlan({ start: "2026-11-01", exams, topics, done: [], settings: { ...settings, sessionMins: 0 } });
    expect(zeroBlock.sessions.every((s) => s.plannedMins > 0)).toBe(true);
    const nanDaily = generatePlan({ start: "2026-11-01", exams, topics, done: [], settings: { ...settings, dailyMinutes: NaN } });
    expect(nanDaily.sessions).toEqual([]);
    expect(nanDaily.unscheduled).toHaveLength(2);
  });

  it("skips revision days that are already in the past", () => {
    const { sessions } = generatePlan({
      start: "2026-11-02", exams: [exam(1, 1, "2026-11-03")], topics: [topic(1)], done: [], settings: { ...settings, revisionDays: 3 },
    });
    expect(sessions.every((s) => s.date >= "2026-11-02" && s.date < "2026-11-03")).toBe(true);
  });

  it("gives weak, low-confidence topics more time and skips revised ones", () => {
    expect(topicMinutes(topic(1, 1, { weak: true, confidence: 1 }))).toBeGreaterThan(topicMinutes(topic(2)));
    expect(topicMinutes(topic(3, 1, { status: "revised" }))).toBe(0);
  });
});
