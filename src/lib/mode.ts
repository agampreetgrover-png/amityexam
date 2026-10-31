import { useLiveQuery } from "dexie-react-hooks";
import { db, getSettings } from "./db";
import type { Exam, ExamMode, ExamType, Material, Topic, Unit } from "./types";

export const MODES: ExamMode[] = ["mid-term", "end-term"];

const LABELS: Record<ExamMode, string> = { "mid-term": "Mid-sem", "end-term": "Major (End-term)" };
export const modeLabel = (m: ExamMode) => LABELS[m];
/** Short form for tight spots (pills, titles). */
export const modeShort = (m: ExamMode) => (m === "mid-term" ? "Mid-sem" : "Major");
export const otherMode = (m: ExamMode): ExamMode => (m === "mid-term" ? "end-term" : "mid-term");

// "other" belongs to both seasons, since we can't tell which it is.
const MODE_TYPES: Record<ExamMode, ExamType[]> = {
  "mid-term": ["mid-term", "internal", "other"],
  "end-term": ["end-term", "practical", "viva", "other"],
};

/** Whether an exam belongs to the mode. No mode (not loaded yet) means everything. */
export const examInMode = (exam: Pick<Exam, "type">, mode?: ExamMode) => !mode || MODE_TYPES[mode].includes(exam.type);

/** The season an exam type points to; "other" could be either. */
export const examTypeMode = (type: ExamType): ExamMode | undefined =>
  type === "other" ? undefined : MODE_TYPES["mid-term"].includes(type) ? "mid-term" : "end-term";

/**
 * One syllabus per subject; the mid-sem covers part of it. A unit tagged "mid-term" is in the mid-sem,
 * and every unit (tagged or not) is in the major. Untagged units are major-only.
 */
const unitMode = (unit: Pick<Unit, "exam">): ExamMode => unit.exam ?? "end-term";

/** Whether a unit is in the mode's syllabus: all units for the major, only mid-sem units for the mid-sem. No mode means everything. */
export const unitInScope = (unit: Pick<Unit, "exam">, mode?: ExamMode) => !mode || mode === "end-term" || unitMode(unit) === "mid-term";

/** Topics in the mode's syllabus. A topic whose unit isn't in `units` counts as major-only. */
export function topicsInScope<T extends Pick<Topic, "unitId">>(topics: T[], units: Unit[], mode?: ExamMode): T[] {
  if (!mode || mode === "end-term") return topics;
  const mid = new Set(units.filter((u) => unitMode(u) === "mid-term").map((u) => u.id));
  return topics.filter((t) => mid.has(t.unitId));
}

/**
 * Topics an exam covers: ticked topics as given, otherwise the subject's topics in the exam's
 * season (from its type; "other" follows `mode`, or everything).
 */
export function examSyllabus(exam: Exam, topics: Topic[], units: Unit[], mode?: ExamMode): Topic[] {
  if (exam.topicIds.length) {
    const ids = new Set(exam.topicIds);
    return topics.filter((t) => t.id != null && ids.has(t.id));
  }
  const season = examTypeMode(exam.type) ?? mode;
  return (season ? topicsInScope(topics, units, season) : topics).filter((t) => t.subjectId === exam.subjectId);
}

// File-name hints for past papers: "Minor_2023", "midsem", "Mid-Term" vs "Major", "EndSem", "end_term".
// Whole words only, so "middleware" or "legend" don't count.
const PYQ_HINTS: Record<ExamMode, RegExp> = {
  "mid-term": /(^|[^a-z])(minor|mid(?:[-_ ]?(?:sem|semester|term))?)(?![a-z])/,
  "end-term": /(^|[^a-z])(major|end(?:[-_ ]?(?:sem|semester|term))?)(?![a-z])/,
};

/** The exam a past paper is for: its tag (from Drive or AI analysis), else an unambiguous file-name hint. */
export function pyqMode(paper: string | Pick<Material, "fileName" | "pyqExam">): ExamMode | undefined {
  if (typeof paper !== "string" && paper.pyqExam) return paper.pyqExam;
  const name = (typeof paper === "string" ? paper : paper.fileName).toLowerCase();
  const mid = PYQ_HINTS["mid-term"].test(name);
  const end = PYQ_HINTS["end-term"].test(name);
  return mid === end ? undefined : mid ? "mid-term" : "end-term"; // both or neither: unknown
}

/** Whether a past paper is for the mode. Papers of unknown type match neither mode. */
export const pyqMatchesMode = (paper: string | Pick<Material, "fileName" | "pyqExam">, mode?: ExamMode) => !!mode && pyqMode(paper) === mode;

/** Materials the AI may use in a mode: all study material, but only this exam's past papers. */
export const materialsForMode = <M extends Pick<Material, "kind" | "fileName" | "pyqExam">>(materials: M[], mode?: ExamMode) =>
  materials.filter((m) => m.kind !== "pyq" || pyqMatchesMode(m, mode));

/** What the AI should know about the exam being prepared for (spread into an AI request body). */
export function aiModeFields(mode: ExamMode | undefined, units: Unit[]) {
  if (!mode) return {};
  // Same caps as the AI request schema (50 units, 300 characters each), so a big syllabus can't cause a 400.
  return { examMode: mode, scopeUnits: units.filter((u) => unitInScope(u, mode)).slice(0, 50).map((u) => u.title.slice(0, 300)) };
}

/** The chosen exam mode; undefined while loading or before it's picked. */
export function useExamMode(): ExamMode | undefined {
  return useLiveQuery(async () => (await getSettings()).examMode);
}

export async function setExamMode(examMode: ExamMode) {
  await db.transaction("rw", db.settings, async () => {
    await db.settings.put({ ...(await getSettings()), examMode });
  });
}
