import { createEvents, type DateArray, type EventAttributes } from "ics";
import { today } from "./dates";
import type { Exam, StudySession, Subject, Topic } from "./types";

interface IcsInput {
  exams: Exam[];
  sessions: StudySession[];
  subjects: Subject[];
  topics: Topic[];
  /** Only sessions on or after this day are exported (defaults to today). */
  from?: string;
}

const dayArray = (day: string, mins: number): DateArray => {
  const [y, m, d] = day.split("-").map(Number);
  return [y, m, d, Math.floor(mins / 60), mins % 60];
};

const parseTime = (t?: string) => {
  const [h, m] = (t ?? "10:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Builds an .ics file of exams and upcoming unfinished sessions so a phone calendar can send reminders. */
export function buildIcs({ exams, sessions, subjects, topics, from = today() }: IcsInput): string {
  const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
  const topicById = new Map(topics.map((t) => [t.id, t]));
  const examById = new Map(exams.map((e) => [e.id, e]));
  const events: EventAttributes[] = [];

  for (const e of exams) {
    if (e.date < from) continue;
    const name = subjectName.get(e.subjectId) ?? "Exam";
    events.push({
      uid: `amityexams-exam-${e.id}@local`,
      title: `📝 EXAM: ${name} (${e.type})`,
      start: dayArray(e.date, parseTime(e.time)),
      duration: { minutes: e.durationMins ?? 180 },
      location: [e.venue, e.seat && `Seat ${e.seat}`].filter(Boolean).join(", ") || undefined,
      description: e.notes,
      alarms: [
        { action: "display", description: `Exam tomorrow: ${name}`, trigger: { days: 1, before: true } },
        { action: "display", description: `Exam in 2 hours: ${name}`, trigger: { hours: 2, before: true } },
      ],
    });
  }

  // Sessions have no clock time: stack each day's sessions from 09:00.
  const byDay = new Map<string, StudySession[]>();
  for (const s of sessions) {
    if (s.done || s.date < from) continue;
    byDay.set(s.date, [...(byDay.get(s.date) ?? []), s]);
  }
  for (const [day, list] of byDay) {
    // Start early enough that a long day still ends by midnight (an hour of 24+ is invalid).
    const total = list.reduce((a, s) => a + s.plannedMins + 10, 0);
    let cursor = Math.max(0, Math.min(9 * 60, 24 * 60 - total));
    for (const s of list) {
      let title: string;
      if (s.kind === "revision") {
        const exam = s.examId != null ? examById.get(s.examId) : undefined;
        title = `🔁 Revise: ${exam ? subjectName.get(exam.subjectId) ?? "Exam" : "Exam"}`;
      } else {
        const t = s.topicId != null ? topicById.get(s.topicId) : undefined;
        title = `📖 ${t ? subjectName.get(t.subjectId) ?? "Study" : "Study"}: ${t?.title ?? "Topic"}`;
      }
      events.push({
        uid: `amityexams-session-${s.id ?? `${day}-${cursor}`}@local`,
        title,
        start: dayArray(day, Math.min(cursor, 23 * 60 + 59)),
        duration: { minutes: s.plannedMins },
        alarms: [{ action: "display", description: title, trigger: { minutes: 15, before: true } }],
      });
      cursor += s.plannedMins + 10; // short break between blocks
    }
  }

  if (!events.length) return "";
  const { error, value } = createEvents(events, { productId: "amityexams/ics", calName: "Amity Exams" });
  if (error || !value) throw error ?? new Error("Could not build calendar file");
  return value;
}
