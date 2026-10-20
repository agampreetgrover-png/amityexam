import { describe, expect, it } from "vitest";
import { buildIcs } from "./calendar";
import type { Exam, StudySession, Subject, Topic } from "./types";

const subjects: Subject[] = [{ id: 1, name: "DBMS", color: "#000", createdAt: 0 }];
const topics: Topic[] = [
  { id: 1, subjectId: 1, unitId: 1, title: "Normalization", difficulty: 3, confidence: 3, status: "not-started", ease: 2.5, interval: 0, reps: 0 },
];
const exams: Exam[] = [{ id: 1, subjectId: 1, type: "end-term", date: "2026-12-10", time: "14:00", topicIds: [], checklist: [] }];
const sessions: StudySession[] = [
  { id: 1, date: "2026-12-01", topicId: 1, kind: "study", plannedMins: 60, actualMins: 0, done: false },
  { id: 2, date: "2026-12-01", examId: 1, kind: "revision", plannedMins: 30, actualMins: 0, done: false },
  { id: 3, date: "2026-12-02", topicId: 1, kind: "study", plannedMins: 60, actualMins: 60, done: true },
];

describe("buildIcs", () => {
  it("exports exams and unfinished sessions with alarms", () => {
    const ics = buildIcs({ exams, sessions, subjects, topics, from: "2026-11-01" });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("EXAM: DBMS (end-term)");
    expect(ics).toContain("DBMS: Normalization");
    expect(ics).toContain("Revise: DBMS");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3); // done session skipped
    expect(ics.match(/BEGIN:VALARM/g)?.length).toBe(4);
  });

  it("keeps a very long study day inside the calendar day", () => {
    const long: StudySession[] = Array.from({ length: 10 }, (_, i) => ({
      id: 10 + i, date: "2026-12-03", topicId: 1, kind: "study", plannedMins: 120, actualMins: 0, done: false,
    }));
    const ics = buildIcs({ exams: [], sessions: long, subjects, topics, from: "2026-11-01" });
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(10);
  });

  it("returns empty string when nothing is upcoming", () => {
    expect(buildIcs({ exams, sessions, subjects, topics, from: "2027-01-01" })).toBe("");
  });
});
