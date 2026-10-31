import type { ChecklistItem, Exam, ExamType } from "./types";

/** Soonest first: by day, then start time, so a 09:30 paper comes before a 14:00 practical the same day. */
export const byWhen = (a: Pick<Exam, "date" | "time">, b: Pick<Exam, "date" | "time">) =>
  a.date.localeCompare(b.date) || byTime(a.time, b.time);
// "HH:mm" sorts correctly as plain text. No time goes after the timed ones; localeCompare would rank a "~" stand-in first.
const byTime = (a?: string, b?: string) => (!a ? (b ? 1 : 0) : !b ? -1 : a < b ? -1 : a > b ? 1 : 0);

export const EXAM_TYPES: { value: ExamType; label: string }[] = [
  { value: "internal", label: "Internal / class test" },
  { value: "mid-term", label: "Mid-term" },
  { value: "end-term", label: "End-term" },
  { value: "practical", label: "Practical / lab" },
  { value: "viva", label: "Viva" },
  { value: "other", label: "Other" },
];

export type Urgency = "critical" | "soon" | "later" | "past";
/** How close an exam is: coral under a week, amber under two weeks, plain after that. */
export const urgency = (days: number): Urgency => (days < 0 ? "past" : days < 7 ? "critical" : days < 15 ? "soon" : "later");
/** Under two weeks to go: the countdown figure gets an urgency rule. */
export const isUrgent = (days: number) => days >= 0 && days < 15;
/** The class for an urgent countdown figure's rule: coral under a week, amber under two. */
export const urgentMark = (days: number) => (urgency(days) === "critical" ? "mark mark-critical" : urgency(days) === "soon" ? "mark" : undefined);

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
