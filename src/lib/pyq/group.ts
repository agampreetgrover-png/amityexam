// Pure helpers for the past-paper question bank: no I/O, so they're easy to test.
import { pyqMode } from "../mode";
import type { ExamMode, Material, PyqQuestion, Topic, Unit } from "../types";

/** The paper's year: read from the paper by AI when analysed, else the first plausible year in its name. */
export function paperYear(m: Pick<Material, "paperYear" | "fileName">): number | undefined {
  if (m.paperYear) return m.paperYear;
  const y = m.fileName.match(/(?:^|[^0-9])((?:19|20)\d\d)(?![0-9])/)?.[1];
  return y ? Number(y) : undefined;
}

/** Only this exam's papers. Strict: a paper of unknown exam type is in neither mode (see unknownExamPapers). */
export const papersForMode = <T extends Pick<Material, "pyqExam" | "fileName">>(papers: T[], mode: ExamMode): T[] =>
  papers.filter((p) => pyqMode(p) === mode);

/** Papers nothing says the exam of yet; the student sorts them by hand. */
export const unknownExamPapers = <T extends Pick<Material, "pyqExam" | "fileName">>(papers: T[]): T[] =>
  papers.filter((p) => !pyqMode(p));

/** Questions belonging to the given papers. */
export function questionsOf(questions: PyqQuestion[], papers: Pick<Material, "id">[]): PyqQuestion[] {
  const ids = new Set(papers.map((p) => p.id));
  return questions.filter((q) => ids.has(q.materialId));
}

/** A question still to be matched: never matched, or matched to a topic that has since been deleted. */
export const needsMapping = (q: Pick<PyqQuestion, "topicId">, topicIds: Set<number | undefined>) =>
  q.topicId === undefined || (q.topicId !== null && !topicIds.has(q.topicId));

/** Newest year first; papers with no known year go last. */
export function newestFirst<T extends Pick<Material, "paperYear" | "fileName">>(papers: T[]): T[] {
  return [...papers].sort((a, b) => (paperYear(b) ?? -1) - (paperYear(a) ?? -1) || a.fileName.localeCompare(b.fileName));
}

/** "Q2(b)" before "Q10": compare question numbers naturally. */
export const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

export interface YearGroup<P> {
  year: number | null;
  papers: { paper: P; questions: PyqQuestion[] }[];
}

/** Papers grouped by year (newest first, unknown year last), each with its questions in printed order. */
export function groupByYear<P extends Pick<Material, "id" | "paperYear" | "fileName">>(papers: P[], questions: PyqQuestion[]): YearGroup<P>[] {
  const byPaper = new Map<number, PyqQuestion[]>();
  for (const q of questions) byPaper.set(q.materialId, [...(byPaper.get(q.materialId) ?? []), q]);
  const groups = new Map<number | null, YearGroup<P>>();
  for (const paper of newestFirst(papers)) {
    const year = paperYear(paper) ?? null;
    if (!groups.has(year)) groups.set(year, { year, papers: [] });
    const qs = [...(byPaper.get(paper.id!) ?? [])].sort((a, b) => naturalCompare(a.number, b.number));
    groups.get(year)!.papers.push({ paper, questions: qs });
  }
  return [...groups.values()];
}

export interface TopicStat {
  topic: Topic;
  questions: PyqQuestion[]; // newest first
  count: number;
  years: [number, number] | null; // first and last year asked
  marks: number; // total marks where known
  hot: boolean; // among the most-asked topics
}

export interface TopicGroups {
  units: { unit: Unit; topics: TopicStat[] }[];
  notInSyllabus: PyqQuestion[]; // checked: matches no topic
  unmatched: PyqQuestion[]; // not mapped to the syllabus yet
  neverAsked: Topic[];
}

const byNewest = (a: PyqQuestion, b: PyqQuestion) => (b.year ?? -1) - (a.year ?? -1) || naturalCompare(a.number, b.number);

/** The count a topic needs to be "frequently asked": top quarter of asked topics, and at least twice. */
export function hotThreshold(counts: number[]): number {
  const asked = counts.filter((c) => c > 0).sort((a, b) => b - a);
  if (!asked.length) return Infinity;
  return Math.max(2, asked[Math.max(0, Math.ceil(asked.length * 0.25) - 1)]);
}

/** Questions grouped by unit → topic in syllabus order, with how often and when each topic was asked. */
export function groupByTopic(questions: PyqQuestion[], units: Unit[], topics: Topic[]): TopicGroups {
  const byTopic = new Map<number, PyqQuestion[]>();
  const notInSyllabus: PyqQuestion[] = [];
  const unmatched: PyqQuestion[] = [];
  const known = new Set(topics.map((t) => t.id));
  for (const q of questions) {
    // A topic deleted since matching isn't "not in the syllabus": the question just needs matching again.
    if (needsMapping(q, known)) unmatched.push(q);
    else if (q.topicId === null || q.topicId === undefined) notInSyllabus.push(q);
    else byTopic.set(q.topicId, [...(byTopic.get(q.topicId) ?? []), q]);
  }
  const threshold = hotThreshold([...byTopic.values()].map((qs) => qs.length));
  const stat = (topic: Topic): TopicStat => {
    const qs = [...(byTopic.get(topic.id!) ?? [])].sort(byNewest);
    const years = qs.map((q) => q.year).filter((y): y is number => !!y);
    return {
      topic,
      questions: qs,
      count: qs.length,
      years: years.length ? [Math.min(...years), Math.max(...years)] : null,
      marks: qs.reduce((a, q) => a + (q.marks ?? 0), 0),
      hot: qs.length >= threshold,
    };
  };
  const neverAsked: Topic[] = [];
  const out: TopicGroups["units"] = [];
  for (const unit of units) {
    const stats = topics.filter((t) => t.unitId === unit.id).map(stat);
    neverAsked.push(...stats.filter((s) => !s.count).map((s) => s.topic));
    const asked = stats.filter((s) => s.count);
    if (asked.length) out.push({ unit, topics: asked });
  }
  return { units: out, notInSyllabus: notInSyllabus.sort(byNewest), unmatched: unmatched.sort(byNewest), neverAsked };
}

/** Case-insensitive text search over questions. */
export const searchQuestions = (qs: PyqQuestion[], query: string) => {
  const q = query.trim().toLowerCase();
  return q ? qs.filter((x) => x.text.toLowerCase().includes(q)) : qs;
};
