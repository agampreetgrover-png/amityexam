import { useLiveQuery } from "dexie-react-hooks";
import { db, getSettings } from "./db";
import type { Exam, ExamMode, ExamType, Material, Topic, Unit } from "./types";

export const MODES: ExamMode[] = ["mid-term", "end-term"];

const LABELS: Record<ExamMode, string> = { "mid-term": "Mid-sem", "end-term": "Major (End-sem)" };
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
 * Each mode has its own syllabus: a unit belongs to the mode it was created or imported in.
 * Units from before modes existed have no tag and count as the major syllabus.
 */
export const unitMode = (unit: Pick<Unit, "exam">): ExamMode => unit.exam ?? "end-term";

/** Whether a unit is in the mode's syllabus. No mode (not loaded yet) means everything. */
export const unitInScope = (unit: Pick<Unit, "exam">, mode?: ExamMode) => !mode || unitMode(unit) === mode;

/** Topics in the mode's syllabus. A topic whose unit isn't in `units` is treated like a legacy (major) one. */
export function topicsInScope<T extends Pick<Topic, "unitId">>(topics: T[], units: Unit[], mode?: ExamMode): T[] {
  if (!mode) return topics;
  const unitModes = new Map(units.map((u) => [u.id, unitMode(u)]));
  return topics.filter((t) => (unitModes.get(t.unitId) ?? "end-term") === mode);
}

// File-name hints for past papers: "Minor_2023", "midsem", "Mid-Term" vs "Major", "EndSem", "end-term".
const PYQ_HINTS: Record<ExamMode, RegExp> = {
  "mid-term": /(^|[^a-z])(minor|mid)/,
  "end-term": /(^|[^a-z])(major|end)/,
};
/** Whether a past paper is for the mode: its Drive tag when it has one, else hints in the file name. */
export function pyqMatchesMode(paper: string | Pick<Material, "fileName" | "pyqExam">, mode?: ExamMode) {
  if (!mode) return false;
  if (typeof paper !== "string" && paper.pyqExam) return paper.pyqExam === mode;
  return PYQ_HINTS[mode].test((typeof paper === "string" ? paper : paper.fileName).toLowerCase());
}

/** What the AI should know about the exam being prepared for (spread into an AI request body). */
export function aiModeFields(mode: ExamMode | undefined, units: Unit[]) {
  if (!mode) return {};
  return { examMode: mode, scopeUnits: units.filter((u) => unitInScope(u, mode)).map((u) => u.title).slice(0, 50) };
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
