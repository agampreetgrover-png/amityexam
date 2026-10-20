import { addDay, daysBetween, weekday } from "./dates";
import type { Exam, ISODay, Settings, StudySession, Topic } from "./types";

interface PlanInput {
  start: ISODay;
  exams: Exam[];
  topics: Topic[];
  /** Sessions already completed; their minutes count towards a topic's need. */
  done: StudySession[];
  settings: Pick<Settings, "dailyMinutes" | "offDays" | "revisionDays" | "sessionMins">;
}

export interface PlanResult {
  sessions: StudySession[];
  /** Topics (with leftover minutes) that could not fit before their exam. */
  unscheduled: { topicId: number; examId: number; minutes: number }[];
}

const roundTo15 = (n: number) => Math.max(15, Math.round(n / 15) * 15);

/** Minutes a topic needs: harder and less-confident topics get more time. */
export function topicMinutes(t: Topic): number {
  if (t.status === "revised") return 0;
  const base = t.difficulty * (6 - t.confidence) * 8; // 8–200
  const weak = t.weak ? 1.5 : 1;
  const studied = t.status === "studied" ? 0.4 : 1; // only a refresher left
  return roundTo15(Math.min(240, Math.max(30, base * weak * studied)));
}

/** Topics an exam covers: explicit list, or every topic of the subject. */
export function examTopics(exam: Exam, topics: Topic[]): Topic[] {
  if (exam.topicIds.length) {
    const ids = new Set(exam.topicIds);
    return topics.filter((t) => t.id != null && ids.has(t.id));
  }
  return topics.filter((t) => t.subjectId === exam.subjectId);
}

/**
 * Earliest-deadline-first scheduler. Exams are handled in date order; each topic is packed
 * into the earliest free study days before that exam's revision window. Work that doesn't fit
 * is reported against that exam and carried over to the next exam covering the same topic.
 * Re-running it from today is the "rebalance": missed sessions simply re-enter the pool.
 */
export function generatePlan({ start, exams, topics, done, settings }: PlanInput): PlanResult {
  // Guard against bad settings: a zero block length would never make progress.
  const daily = Math.max(0, Number(settings.dailyMinutes) || 0);
  const block = Math.max(15, Number(settings.sessionMins) || 60);
  const revisionDays = Math.max(0, Math.floor(Number(settings.revisionDays) || 0));

  const upcoming = exams
    .filter((e) => e.id != null && daysBetween(start, e.date) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id! - b.id!);

  const doneMins = new Map<number, number>();
  for (const s of done) {
    if (s.topicId != null && s.done) doneMins.set(s.topicId, (doneMins.get(s.topicId) ?? 0) + s.actualMins);
  }
  // Minutes each topic still needs, shared across exams.
  const remaining = new Map<number, number>();
  const need = (t: Topic) => {
    if (!remaining.has(t.id!)) remaining.set(t.id!, Math.max(0, topicMinutes(t) - (doneMins.get(t.id!) ?? 0)));
    return remaining.get(t.id!)!;
  };

  // Free capacity per day; filled lazily.
  const capacity = new Map<ISODay, number>();
  const cap = (d: ISODay) => {
    if (!capacity.has(d)) capacity.set(d, settings.offDays.includes(weekday(d)) ? 0 : daily);
    return capacity.get(d)!;
  };

  const sessions: StudySession[] = [];
  const unscheduled: PlanResult["unscheduled"] = [];

  // Revision blocks first, so study never eats an exam's last days.
  for (const exam of upcoming) {
    const covered = examTopics(exam, topics);
    if (!covered.length) continue;
    const want = Math.min(daily, Math.max(60, covered.length * 15));
    for (let i = 1; i <= revisionDays; i++) {
      const d = addDay(exam.date, -i);
      if (daysBetween(start, d) < 0) continue;
      const mins = Math.min(want, cap(d));
      if (mins <= 0) continue;
      capacity.set(d, cap(d) - mins);
      sessions.push({ date: d, examId: exam.id, kind: "revision", plannedMins: mins, actualMins: 0, done: false });
    }
  }

  for (const exam of upcoming) {
    const lastStudyDay = addDay(exam.date, -(revisionDays + 1));
    const pool = examTopics(exam, topics)
      .filter((t) => need(t) > 0)
      // Hardest first so they land earliest, when there's most slack.
      .sort((a, b) => need(b) - need(a) || a.id! - b.id!);

    let day = start;
    for (const t of pool) {
      let left = need(t);
      while (left > 0 && daysBetween(day, lastStudyDay) >= 0) {
        const free = cap(day);
        if (free < 15) {
          day = addDay(day, 1);
          continue;
        }
        const mins = Math.min(left, free, block);
        capacity.set(day, free - mins);
        left -= mins;
        sessions.push({ date: day, topicId: t.id, kind: "study", plannedMins: mins, actualMins: 0, done: false });
      }
      remaining.set(t.id!, left);
      if (left > 0) unscheduled.push({ topicId: t.id!, examId: exam.id!, minutes: left });
    }
  }

  sessions.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "study" ? -1 : 1));
  return { sessions, unscheduled };
}
