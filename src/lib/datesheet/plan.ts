// Pure helpers for importing a date sheet: trim the sheet to relevant rows, and turn the
// AI's findings into reviewable rows with clash detection against existing exams.
import type { DatesheetResult } from "../ai/schemas";
import type { Exam, ExamType, Subject } from "../types";

const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

/** "CSE201 | Database Management Systems" for each subject, in order: the AI answers with these indexes. */
export const subjectLabels = (subjects: Pick<Subject, "name" | "code">[]) =>
  subjects.map((s) => `${s.code?.trim() || "(no code)"} | ${s.name}`);

const HEADER_LINES = 8;
const DATE = /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b(mon|tues|wednes|thurs|fri|satur|sun)day\b/i;
const TIME_RANGE = /\d{1,2}[:.]\d{2}\s*(am|pm)?\s*(to|-|–)\s*\d{1,2}[:.]\d{2}/i;
const SMALL_ENOUGH = 10_000; // fits the smallest provider budget (Groq clips at ~12K)

/**
 * University date sheets list every programme. When a sheet is big, keep the first few lines
 * (titles, column headers) plus only the lines that mention one of the student's codes or names.
 */
export function relevantRows(text: string, subjects: Pick<Subject, "name" | "code">[]): string {
  if (text.length <= SMALL_ENOUGH) return text;
  const codes = subjects.map((s) => s.code?.replace(/\s/g, "").toLowerCase()).filter((c): c is string => !!c && c.length >= 4);
  const names = subjects.map((s) => norm(s.name)).filter((n) => n.length >= 4);
  const lines = text.split("\n");
  const keep = new Set<number>();
  let lastDate = -1, lastTime = -1, matched = 0;
  lines.forEach((line, i) => {
    if (i < HEADER_LINES || /^#{1,3} /.test(line)) keep.add(i); // titles and per-sheet headings
    if (DATE.test(line)) lastDate = i;
    if (TIME_RANGE.test(line)) lastTime = i;
    const squashed = line.replace(/\s/g, "").toLowerCase();
    const n = norm(line);
    if (codes.some((c) => squashed.includes(c)) || names.some((nm) => n.includes(nm))) {
      // A paper's date and time slot are often on an earlier row ("TUESDAY (09-09-25)", "(02:00 to 03:00 PM)").
      for (const ctx of [lastDate, lastTime, i]) if (ctx >= 0) keep.add(ctx);
      matched++;
    }
  });
  // Nothing matched (e.g. a sheet that only uses names we spell differently): send the start instead.
  if (!matched) return text.slice(0, SMALL_ENOUGH);
  return [...keep].sort((a, b) => a - b).map((i) => lines[i]).join("\n");
}

export interface ImportRow {
  key: string;
  include: boolean;
  subjectId: number | null; // null = not one of the student's subjects
  date: string;
  time: string;
  durationMins?: number;
  type: ExamType;
  clash?: Exam; // existing exam for the same subject and type on a different date
  duplicate: boolean; // identical exam already saved
  action: "add" | "update"; // what to do when there's a clash
}

/**
 * Whether a row matches an exam you already have: same date = duplicate (left unticked),
 * same subject and type on another date = clash (offer to move that exam).
 */
export function clashFor(existing: Exam[], subjectId: number | null, type: ExamType, date: string): Pick<ImportRow, "clash" | "duplicate" | "action"> {
  const same = subjectId == null ? [] : existing.filter((x) => x.subjectId === subjectId && x.type === type);
  const duplicate = same.some((x) => x.date === date);
  const clash = duplicate ? undefined : same[0];
  return { clash, duplicate, action: clash ? "update" : "add" };
}

/** Turn the AI's findings into review rows. */
export function planImport(found: DatesheetResult["exams"], subjects: Subject[], existing: Exam[]): ImportRow[] {
  const seen = new Set<string>();
  const rows: ImportRow[] = [];
  found.forEach((e, i) => {
    const subject = e.subject >= 0 ? subjects[e.subject] : undefined;
    const subjectId = subject?.id ?? null;
    const sig = `${subjectId}|${e.date}|${e.type}`;
    if (seen.has(sig)) return; // the AI listed the same exam twice
    seen.add(sig);
    const match = clashFor(existing, subjectId, e.type, e.date);
    rows.push({
      key: `${i}-${sig}`,
      include: subjectId != null && !match.duplicate,
      subjectId,
      date: e.date,
      time: e.time ?? "",
      durationMins: e.durationMins ?? undefined,
      type: e.type,
      ...match,
    });
  });
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
