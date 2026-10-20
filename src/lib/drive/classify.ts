// Pure helpers (no I/O): match Drive folders/files to subjects, and sort files into notes / slides / past papers.

export type DriveKind = "notes" | "ppt" | "pyq";
export type PyqExam = "mid-term" | "end-term";

export interface SubjectRef {
  id: number;
  name: string;
  code?: string;
}

const MINOR_WORDS = new Set(["and", "of", "the", "for", "in", "to", "a", "an", "with", "using", "&"]);
const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const words = (s: string) => norm(s).split(" ").filter(Boolean);
const significant = (s: string) => words(s).filter((w) => !MINOR_WORDS.has(w));

/** Acronyms a subject is commonly called by: "Database Management Systems" → dbms. */
function acronyms(name: string): string[] {
  const sig = significant(name).map((w) => w[0]).join("");
  const all = words(name).map((w) => w[0]).join("");
  return [...new Set([sig, all])].filter((a) => a.length >= 2);
}

const codeOf = (s: string) => s.toUpperCase().match(/\b([A-Z]{2,5}\s?\d{3})\b/)?.[1].replace(/\s/g, "");

/**
 * How well a Drive name (folder or file) refers to a subject, 0–1.
 * Course codes are decisive; then acronyms (DBMS, ADAA); then word overlap.
 */
export function subjectScore(driveName: string, s: SubjectRef): number {
  const code = s.code?.toUpperCase().replace(/\s/g, "") || codeOf(s.name);
  const driveCode = codeOf(driveName);
  if (code && driveCode) return code === driveCode ? 1 : 0;

  const dn = norm(driveName);
  const dWords = new Set(words(driveName));
  // Acronym match, e.g. folder "DBMS" or a file named "DBMS Major 2021".
  for (const a of acronyms(s.name)) {
    if (dWords.has(a)) return 0.9;
    // One extra letter: "DBMS" for "Database Management Systems" (dms), "ADAA" for "Analysis & Design of Algorithms" (ada).
    for (const w of dWords) {
      if (a.length >= 3 && w.length === a.length + 1 && [...w].some((_, i) => w.slice(0, i) + w.slice(i + 1) === a)) return 0.8;
    }
  }
  const sig = significant(s.name);
  if (!sig.length) return 0;
  // "Cybersecurity" vs "Essentials of Cyber Security": compare with spaces removed too.
  const squashed = dn.replace(/ /g, "");
  const hits = sig.filter((w) => dWords.has(w) || (w.length >= 4 && squashed.includes(w))).length;
  const ratio = hits / sig.length;
  return ratio >= 0.6 ? 0.5 + ratio * 0.3 : 0;
}

export const MATCH_THRESHOLD = 0.6;

const SKIP_FOLDER = /\b(books?|e-?books?|labs?|practicals?|assignments?|attendance)\b/i;
export const skipFolder = (name: string) => SKIP_FOLDER.test(name);

const PYQ_FOLDER = /\b(pyqs?|papers?|question ?papers?|previous|qp)\b/i;
const PYQ_NAME = /\b(pyqs?|major|minor|mid[ -]?sem|mid[ -]?term|end[ -]?sem|end[ -]?term|question ?paper|qp|paper|set[ -]?\d)\b/i;
const SKIP_NAME = /\b(assignments?|prac(tical)? ?file|lab ?(file|manual)|e-?book|textbook|attendance|datesheet|date ?sheet|schedule)\b/i;
const MINOR = /\b(minor|mid[ -]?sem|mid[ -]?term|midsem|internal)\b/i;
const MAJOR = /\b(major|end[ -]?sem|end[ -]?term|endsem|final)\b/i;

const ext = (name: string) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
export const SUPPORTED_EXT = new Set(["pdf", "docx", "pptx", "txt", "md"]);

/** Decide what a Drive file is, or null to skip it. `type` is the Drive entry type (gdoc/gslides are native Google files). */
export function classify(name: string, path: string[], type: string): { kind: DriveKind; pyqExam?: PyqExam } | null {
  const e = ext(name);
  const native = type === "gdoc" || type === "gslides";
  if (!native && !SUPPORTED_EXT.has(e)) return null; // images, spreadsheets, archives, legacy .ppt/.doc
  if (SKIP_NAME.test(name) || path.some(skipFolder)) return null;

  const inPyqFolder = path.some((p) => PYQ_FOLDER.test(p));
  const isSlides = type === "gslides" || e === "pptx";
  if (!isSlides && (inPyqFolder || PYQ_NAME.test(name))) {
    const pyqExam: PyqExam | undefined = MINOR.test(name) ? "mid-term" : MAJOR.test(name) ? "end-term" : undefined;
    return { kind: "pyq", pyqExam };
  }
  return { kind: isSlides ? "ppt" : "notes" };
}
