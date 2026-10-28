import type { ChecklistItem, Exam, ExamType } from "./types";

/** Soonest first: by day, then start time, so a 09:30 paper comes before a 14:00 practical the same day. */
export const byWhen = (a: Pick<Exam, "date" | "time">, b: Pick<Exam, "date" | "time">) =>
  a.date.localeCompare(b.date) || (a.time || "~").localeCompare(b.time || "~"); // no time: after the timed ones

export const EXAM_TYPES: { value: ExamType; label: string }[] = [
  { value: "internal", label: "Internal / class test" },
  { value: "mid-term", label: "Mid-term" },
  { value: "end-term", label: "End-term" },
  { value: "practical", label: "Practical / lab" },
  { value: "viva", label: "Viva" },
  { value: "other", label: "Other" },
];

export const examTypeLabel = (t: ExamType) => EXAM_TYPES.find((x) => x.value === t)?.label ?? t;

export const DEFAULT_CHECKLIST: ChecklistItem[] = [
  "Admit card (printed)",
  "College ID card",
  "2+ blue/black pens, pencil, eraser, sharpener",
  "Scale / geometry box",
  "Calculator (if allowed)",
  "Transparent water bottle",
  "Watch (non-smart)",
  "Check venue, room and seat number",
  "Leave 45 min early",
].map((text) => ({ text, done: false }));
