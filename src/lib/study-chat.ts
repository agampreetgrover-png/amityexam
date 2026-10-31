// The study chat's grounding: which bits of the teacher's notes and which past-paper questions go with a
// question, and a short note on where the student stands for the coming exam. Pure, so it's testable.
import { daysBetween, prettyDay } from "./dates";
import { modeShort } from "./mode";
import { chunk, words } from "./retrieve";
import type { ChatSource, Exam, ExamMode, Material, PyqQuestion, Topic } from "./types";

// Words that say how to answer, not what about ("explain X for 10 marks"); they'd match every chunk.
const ASK_WORDS = new Set("marks mark answer answers question questions write give tell about please exam exams notes teach simple example examples quiz short long detail detailed".split(" "));
const terms = (s: string) => words(s).filter((w) => !ASK_WORDS.has(w));

const overlap = (q: Set<string>, text: string) => {
  const w = terms(text);
  let hits = 0;
  for (const x of w) if (q.has(x)) hits++;
  return hits / Math.sqrt(w.length + 1);
};

/** The note excerpts that best match the question, each headed by its file name so answers can cite it. */
export function noteExcerpts(materials: Pick<Material, "fileName" | "text">[], query: string, maxChars: number): { text: string; files: string[] } {
  const q = new Set(terms(query));
  if (!q.size) return { text: "", files: [] };
  const scored = materials
    .flatMap((m) => chunk(m.text).map((c) => ({ file: m.fileName, c, score: overlap(q, c) })))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const parts: string[] = [];
  const files: string[] = [];
  let size = 0;
  for (const { file, c } of scored) {
    const part = `[Notes: ${file}]\n${c.trim()}`;
    if (size + part.length > maxChars) continue; // a smaller excerpt may still fit
    parts.push(part);
    size += part.length + 5;
    if (!files.includes(file)) files.push(file);
  }
  return { text: parts.join("\n---\n"), files };
}

const label = (q: Pick<PyqQuestion, "year" | "number" | "marks">) =>
  [q.year ?? "year unknown", q.number && q.number, q.marks != null && `${q.marks} marks`].filter(Boolean).join(" · ");

// The same question set in several years reads as one entry: "asked 2019, 2021, 2023".
const sameQuestion = (text: string) => terms(text).slice(0, 14).join(" ");

/**
 * Past-paper questions that match the question (by wording, or through the syllabus topic they were matched to),
 * with how often each topic has been asked. `questions` should be this exam's questions for the subject.
 */
export function matchingPyqs(
  questions: PyqQuestion[],
  topics: Pick<Topic, "id" | "title">[],
  query: string,
  { max = 12, maxChars = 8000 } = {},
): { text: string; picked: PyqQuestion[] } {
  const q = new Set(terms(query));
  if (!q.size || !questions.length) return { text: "", picked: [] };
  const topicById = new Map(topics.map((t) => [t.id!, t]));
  // A question on a topic whose name matches counts even when its own wording doesn't ("normal forms" → Normalization).
  const topicScore = new Map(topics.map((t) => [t.id!, overlap(q, t.title)]));
  const scored = questions
    .map((x) => ({ x, score: overlap(q, x.text) + 0.6 * (typeof x.topicId === "number" ? (topicScore.get(x.topicId) ?? 0) : 0) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || (b.x.year ?? 0) - (a.x.year ?? 0));

  const groups = new Map<string, PyqQuestion[]>();
  for (const { x } of scored) {
    const key = sameQuestion(x.text) || String(x.id);
    groups.set(key, [...(groups.get(key) ?? []), x]);
  }
  const lines: string[] = [];
  const picked: PyqQuestion[] = [];
  let size = 0;
  for (const group of groups.values()) {
    if (lines.length >= max) break;
    const [first, ...rest] = [...group].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    const topic = typeof first.topicId === "number" ? topicById.get(first.topicId)?.title : undefined;
    const also = rest.length ? ` (also asked: ${rest.map(label).join("; ")})` : "";
    const line = `- [PYQ ${label(first)}${topic ? ` · topic: ${topic}` : ""}] ${first.text.trim().slice(0, 600)}${also}`;
    if (size + line.length > maxChars) continue;
    lines.push(line);
    picked.push(first);
    size += line.length + 1;
  }

  // How heavily the topics involved have been examined, across every paper of this exam.
  const stats: string[] = [];
  for (const id of new Set(picked.map((p) => p.topicId).filter((t): t is number => typeof t === "number"))) {
    const all = questions.filter((x) => x.topicId === id);
    const years = [...new Set(all.map((x) => x.year).filter((y): y is number => !!y))].sort();
    const marks = all.map((x) => x.marks).filter((m): m is number => m != null);
    const range = marks.length ? `, ${Math.min(...marks) === Math.max(...marks) ? Math.min(...marks) : `${Math.min(...marks)}–${Math.max(...marks)}`} marks` : "";
    stats.push(`- ${topicById.get(id)?.title ?? "A topic"}: asked ${all.length} time${all.length === 1 ? "" : "s"}${years.length ? ` (${years.join(", ")})` : ""}${range}`);
  }
  const text = lines.join("\n") + (stats.length ? `\n\nHow often these topics are asked:\n${stats.join("\n")}` : "");
  return { text, picked };
}

/** Excerpts from past papers not yet split into questions, so they still count before the analysis catches up. */
export function rawPaperExcerpts(papers: Pick<Material, "fileName" | "text">[], query: string, maxChars: number): string {
  const { text } = noteExcerpts(papers, query, maxChars);
  return text.replace(/\[Notes: /g, "[Past paper: ");
}

export interface PrepInput {
  subjectName: string;
  mode?: ExamMode;
  exam?: Pick<Exam, "date" | "time">; // the next exam of this mode for the subject
  today: string;
  topics: Pick<Topic, "id" | "title" | "status" | "weak" | "confidence">[]; // this exam's syllabus
  questions: Pick<PyqQuestion, "topicId">[]; // this exam's past-paper questions
}

/** Most-asked topics in this exam's papers, busiest first. */
function hotTopics(topics: PrepInput["topics"], questions: PrepInput["questions"], n = 6) {
  const count = new Map<number, number>();
  for (const q of questions) if (typeof q.topicId === "number") count.set(q.topicId, (count.get(q.topicId) ?? 0) + 1);
  return topics
    .filter((t) => count.has(t.id!))
    .map((t) => ({ topic: t, count: count.get(t.id!)! }))
    .sort((a, b) => b.count - a.count || a.topic.title.localeCompare(b.topic.title))
    .slice(0, n);
}

const weakTopics = (topics: PrepInput["topics"], n = 6) => topics.filter((t) => t.weak || t.confidence <= 2).slice(0, n);

/** A few lines on the coming exam, sent with every question so answers are pitched at it. */
export function prepSummary(p: PrepInput): string {
  const lines: string[] = [];
  const season = p.mode ? `${modeShort(p.mode)} exam` : "exam";
  if (p.exam) {
    const days = daysBetween(p.today, p.exam.date);
    const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
    lines.push(`Preparing for the ${p.subjectName} ${season} on ${prettyDay(p.exam.date)}${p.exam.time ? ` at ${p.exam.time}` : ""} (${when}).${days <= 2 ? " Time is short: favour high-yield, exam-ready answers." : ""}`);
  } else lines.push(`Preparing for the ${p.subjectName} ${season} (no date added yet).`);
  const hot = hotTopics(p.topics, p.questions);
  if (hot.length) lines.push(`Most-asked topics in past papers: ${hot.map((h) => `${h.topic.title} (${h.count}×)`).join(", ")}.`);
  const weak = weakTopics(p.topics);
  if (weak.length) lines.push(`Topics the student finds hard: ${weak.map((t) => t.title).join(", ")}.`);
  if (p.topics.length) {
    const notStarted = p.topics.filter((t) => t.status === "not-started").length;
    lines.push(`Syllabus progress: ${p.topics.length - notStarted} of ${p.topics.length} topics studied.`);
  }
  return lines.join("\n");
}

export type StarterKind = "predict" | "model" | "drill" | "plan";

/**
 * The four openers of an empty chat: what's asked most, a model answer on the busiest topic, a quick quiz, and
 * what to do first with the days left. Topics come from this exam's papers; before any paper is matched to the
 * syllabus, a topic the student finds hard or hasn't started stands in.
 */
export function starterTiles(p: PrepInput): { kind: StarterKind; prompt: string }[] {
  const hot = hotTopics(p.topics, p.questions, 2).map((h) => h.topic.title);
  const weak = weakTopics(p.topics, 1).map((t) => t.title);
  const main = hot[0] ?? weak[0] ?? (p.topics.find((t) => t.status === "not-started") ?? p.topics[0])?.title;
  const drill = hot[1] ?? weak[0] ?? main;
  const days = p.exam ? daysBetween(p.today, p.exam.date) : -1;
  return [
    { kind: "predict", prompt: "Top 5 most repeated 10-mark questions" },
    { kind: "model", prompt: main ? `Draft a 10-mark answer: ${main}` : "Draft a 10-mark answer on the most asked topic" },
    { kind: "drill", prompt: `Quiz me on ${drill ?? p.subjectName} (5 questions)` },
    {
      kind: "plan",
      prompt: days < 0 ? "Prioritise my remaining topics for the exam" : days <= 1 ? "What should I revise in the last few hours?" : `Prioritise my remaining topics with ${days} days left`,
    },
  ];
}

/** Sources shown under an answer: the note files used, then the past papers by year. */
export function sourcesOf(files: string[], picked: Pick<PyqQuestion, "year" | "number" | "marks">[]): ChatSource[] {
  return [
    ...files.slice(0, 6).map((f) => ({ kind: "notes" as const, label: f })),
    ...picked.slice(0, 6).map((q) => ({ kind: "pyq" as const, label: label(q) })),
  ];
}

// Left out of a subject's initials, so "Analysis and Design of Algorithms" is "ADA".
const MINOR_WORDS = new Set(["and", "of", "the", "in", "to", "for", "with", "a", "an", "on"]);
const tokens = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/**
 * The one subject a question names, if it isn't `currentId`: by its full name, its code ("CSE201") or its
 * initials ("ada"). Nothing when it names the current subject too, or more than one other, so a passing
 * mention never moves a question.
 */
export function namedSubject<S extends { id?: number; name: string; code?: string }>(question: string, subjects: S[], currentId?: number): S | undefined {
  // Small words are dropped on both sides, so "analysis and design of algorithms" matches "Analysis & Design of Algorithms".
  const major = (t: string[]) => t.filter((w) => !MINOR_WORDS.has(w));
  const q = tokens(question);
  const said = new Set(q);
  const flat = ` ${major(q).join(" ")} `;
  const hits = subjects.filter((s) => {
    const name = major(tokens(s.name));
    const initials = name.map((w) => w[0]).join("");
    return (
      (name.length > 1 && flat.includes(` ${name.join(" ")} `)) ||
      (!!s.code && said.has(s.code.toLowerCase().replace(/[^a-z0-9]/g, ""))) ||
      (initials.length >= 3 && said.has(initials))
    );
  });
  if (hits.some((s) => s.id === currentId)) return undefined;
  return hits.length === 1 ? hits[0] : undefined;
}

/** A conversation's title from its first question. */
export const chatTitle = (question: string) => {
  const t = question.replace(/\s+/g, " ").trim();
  return t.length > 60 ? `${t.slice(0, 57).trimEnd()}…` : t;
};
