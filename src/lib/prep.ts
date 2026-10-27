// Pure helpers for the Zero prep page: which topics can be learned cold, ranked by how much they pay off.
import { importantTopics } from "./pyq/group";
import type { PrepLevel, PyqQuestion, Subject, Topic, TopicPrep } from "./types";

export interface PrepRow {
  topic: Topic;
  subject: Subject;
  prep: TopicPrep;
  questions: PyqQuestion[]; // newest first
  count: number; // times asked in past papers
  marks: number;
  hot: boolean; // among the most-asked topics
  score: number; // quick-win value, see quickWin
}

export type PrepFilter = "zero" | "light"; // light includes zero
export type AskedFilter = "any" | "asked" | "often" | "hot";
export type ImportanceFilter = "any" | "medium" | "high";
export type PrepSort = "wins" | "asked" | "quick";

export interface PrepFilters {
  prep: PrepFilter;
  asked: AskedFilter;
  importance: ImportanceFilter;
  subjectId: number | "all";
}

/**
 * How good a topic is to pick up now: what it's worth (times asked, whether it's among the most asked, how
 * important) for the time it takes, with light-prep topics discounted for the groundwork they need.
 */
export function quickWin(p: Pick<TopicPrep, "level" | "mins" | "importance">, count: number, hot: boolean): number {
  const worth = 1 + count * 1.5 + (hot ? 2 : 0) + (p.importance - 1) * 1.5;
  const ease = p.level === 0 ? 1 : p.level === 1 ? 0.6 : 0.3;
  return (worth * ease) / Math.sqrt(Math.max(5, p.mins) / 20);
}

/**
 * Every rated topic with its past-paper record. `topics` should already be the exam mode's syllabus and
 * `questions` that mode's past-paper questions, as on the Important topics page.
 */
export function prepRows(topics: Topic[], subjects: Subject[], questions: PyqQuestion[]): PrepRow[] {
  const asked = new Map(importantTopics(questions, topics, subjects).map((r) => [r.topic.id, r]));
  const subjectById = new Map(subjects.map((s) => [s.id!, s]));
  const out: PrepRow[] = [];
  for (const topic of topics) {
    const subject = subjectById.get(topic.subjectId);
    if (!topic.prep || !subject) continue;
    const a = asked.get(topic.id);
    const count = a?.count ?? 0;
    const hot = a?.hot ?? false;
    out.push({ topic, subject, prep: topic.prep, questions: a?.questions ?? [], count, marks: a?.marks ?? 0, hot, score: quickWin(topic.prep, count, hot) });
  }
  return out;
}

const maxLevel: Record<PrepFilter, PrepLevel> = { zero: 0, light: 1 };
const minImportance: Record<ImportanceFilter, number> = { any: 1, medium: 2, high: 3 };

export function filterPrep(rows: PrepRow[], f: PrepFilters): PrepRow[] {
  return rows.filter(
    (r) =>
      r.prep.level <= maxLevel[f.prep] &&
      r.prep.importance >= minImportance[f.importance] &&
      (f.subjectId === "all" || r.subject.id === f.subjectId) &&
      (f.asked === "any" || (f.asked === "asked" ? r.count >= 1 : f.asked === "often" ? r.count >= 2 : r.hot)),
  );
}

const byTitle = (a: PrepRow, b: PrepRow) => a.topic.title.localeCompare(b.topic.title);

export function sortPrep(rows: PrepRow[], sort: PrepSort): PrepRow[] {
  const cmp: Record<PrepSort, (a: PrepRow, b: PrepRow) => number> = {
    wins: (a, b) => b.score - a.score || byTitle(a, b),
    asked: (a, b) => b.count - a.count || b.prep.importance - a.prep.importance || a.prep.mins - b.prep.mins || byTitle(a, b),
    quick: (a, b) => a.prep.mins - b.prep.mins || b.score - a.score || byTitle(a, b),
  };
  return [...rows].sort(cmp[sort]);
}

/** "45 min", "1 h", "2 h 30 min". */
export function formatMins(mins: number): string {
  const m = Math.round(mins);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
