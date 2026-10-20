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
// Part numbers that tell apart "Applied Mathematics 1" from "… 2", or "Basic Physics - I" from "- II".
const ROMAN: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6" };
const words = (s: string) => norm(s).split(" ").filter(Boolean).map((w) => ROMAN[w] ?? w);
const significant = (s: string) => words(s).filter((w) => !MINOR_WORDS.has(w));

/** Acronyms a subject is commonly called by: "Database Management Systems" → dbms. */
function acronyms(name: string): string[] {
  const sig = significant(name).map((w) => w[0]).join("");
  const all = words(name).map((w) => w[0]).join("");
  return [...new Set([sig, all])].filter((a) => a.length >= 2);
}

const CODE = /\b([A-Z]{2,5})\s?(\d{3}[A-Z]?)\b/;
const codeOf = (s: string) => {
  const m = s.toUpperCase().match(CODE);
  return m ? m[1] + m[2] : undefined;
};
const withoutCode = (s: string) => s.replace(new RegExp(CODE.source, "gi"), " ");
const withoutExt = (s: string) => s.replace(/\.[a-z0-9]{2,4}$/i, "");

const ordinals = (s: string) => new Set(words(withoutCode(s).replace(/\(\d+\)/g, " ")).filter((w) => /^\d$/.test(w))); // "(1)" = Drive copy marker

/** `w` is acronym `a` with one extra letter, e.g. "dbms" for "dms" (Database Management Systems). */
const oneExtraLetter = (w: string, a: string) =>
  a.length >= 3 && w.length === a.length + 1 && [...w].some((_, i) => w.slice(0, i) + w.slice(i + 1) === a);

/**
 * How well a Drive name (folder or file) refers to a subject, 0–1.
 * Course codes are decisive; then acronyms (DBMS, ADAA); then word overlap.
 */
export function subjectScore(driveName: string, s: SubjectRef): number {
  const code = s.code?.toUpperCase().replace(/\s/g, "") || codeOf(s.name);
  const driveCode = codeOf(driveName);
  if (code && driveCode) return code === driveCode ? 1 : 0;

  const bare = withoutExt(driveName);
  // "Technical Communication 2" must not take "Technical Communication 1"'s folder.
  const want = ordinals(s.name);
  const have = ordinals(bare);
  if (want.size && have.size && ![...want].some((n) => have.has(n))) return 0;

  const name = withoutCode(bare);
  const dn = norm(name);
  const dWords = new Set(words(name));
  if (!dWords.size) return 0;

  // A folder named after the code's letters, e.g. "SKE" for SKE301 (only when the subject has a code).
  if (code && dWords.size === 1 && dWords.has(code.replace(/\d.*$/, "").toLowerCase())) return 0.65;

  if (!driveCode) {
    // Acronym match, e.g. folder "DBMS" or a file named "DBMS Major 2021".
    for (const a of acronyms(s.name)) {
      if (dWords.has(a)) return 0.9;
      // One extra letter: "DBMS" for "Database Management Systems" (dms), "ADAA" for "Analysis & Design of Algorithms" (ada).
      for (const w of dWords) if (oneExtraLetter(w, a)) return 0.8;
    }
  } else {
    // Library folders spell names out; a subject typed as an acronym ("DBMS") matches through the folder's acronym.
    const typed = significant(s.name);
    if (typed.length === 1 && typed[0].length >= 3) {
      for (const a of acronyms(name)) if (typed[0] === a || oneExtraLetter(typed[0], a)) return 0.85;
    }
  }

  const sig = significant(s.name);
  if (!sig.length) return 0;
  // "Cybersecurity" vs "Essentials of Cyber Security": compare with spaces removed too.
  const squashed = dn.replace(/ /g, "");
  const hits = sig.filter((w) => dWords.has(w) || (w.length >= 4 && squashed.includes(w))).length;
  // A library folder is a full course name, so its extra words count against the match too:
  // "Machine Learning" fits "Fundamentals of Machine Learning" better than "Introduction to AI & Machine Learning".
  const ratio = driveCode ? hits / Math.max(sig.length, significant(name).length) : hits / sig.length;
  return ratio >= 0.6 ? 0.5 + ratio * 0.3 : 0;
}

export const MATCH_THRESHOLD = 0.6;

/** The subject a Drive name belongs to: the single best match, or undefined when none fits or two tie. */
export function bestSubject(name: string, subjects: SubjectRef[]): SubjectRef | undefined {
  let best: SubjectRef | undefined;
  let score = 0;
  let tie = false;
  for (const s of subjects) {
    const sc = subjectScore(name, s);
    if (sc > score) [best, score, tie] = [s, sc, false];
    else if (sc === score && sc > 0) tie = true;
  }
  return score >= MATCH_THRESHOLD && !tie ? best : undefined;
}

/**
 * Which top-level folders of ONE Drive source belong to which subject. Each folder goes to its best subject,
 * then each subject keeps only its best-scoring folders, so "Artificial Intelligence" takes the
 * "Artificial Intelligence" folder and not also "Generative Artificial Intelligence". When a subject's best
 * folders tie on a fuzzy score, none is taken (`ambiguous`) and the student links one by hand.
 */
export function pickFolders<F extends { name: string }>(folders: F[], subjects: SubjectRef[]) {
  const bySubject = new Map<number, { f: F; score: number }[]>();
  for (const f of folders) {
    const s = bestSubject(f.name, subjects);
    if (s) bySubject.set(s.id, [...(bySubject.get(s.id) ?? []), { f, score: subjectScore(f.name, s) }]);
  }
  const picked = new Map<number, F[]>();
  const ambiguous = new Map<number, F[]>();
  for (const [id, list] of bySubject) {
    const top = Math.max(...list.map((x) => x.score));
    const best = list.filter((x) => x.score === top).map((x) => x.f);
    if (best.length > 1 && top < 0.9) ambiguous.set(id, best);
    else picked.set(id, best);
  }
  return { picked, ambiguous };
}

const SKIP_FOLDER = /\b(books?|e-?books?|labs?|practicals?|assignments?|attendance)\b/i;
export const skipFolder = (name: string) => SKIP_FOLDER.test(name);

const PYQ_FOLDER = /\b(pyqs?|papers?|question ?papers?|previous|qp)\b/i;
const PYQ_NAME = /\b(pyqs?|major|minor|mid[ -]?sem|mid[ -]?term|end[ -]?sem|end[ -]?term|question ?paper|qp|paper|set[ -]?\d)\b/i;
const SKIP_NAME = /\b(assignments?|prac(tical)? ?file|lab ?(file|manual)|e[- ]?books?|text ?books?|reference ?books?|attendance|datesheet|date ?sheet|schedule)\b/i;
const STUDY_NAME = /\b(ppts?|slides?|notes?|modules?|mod|units?|chapters?|lectures?)\b/i;
const PAPER_NAME = /\b(pyqs?|question ?papers?|qp|papers?|exam)\b/i;
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
  // "Mod 1,2 Minor ppt.pdf" is slides for the minor exam, not a minor paper: study-material words win
  // over an exam word unless the name also says it's a paper.
  const studyMaterial = STUDY_NAME.test(name) && !PAPER_NAME.test(name);
  if (!isSlides && (inPyqFolder || (PYQ_NAME.test(name) && !studyMaterial))) {
    const pyqExam: PyqExam | undefined = MINOR.test(name) ? "mid-term" : MAJOR.test(name) ? "end-term" : undefined;
    return { kind: "pyq", pyqExam };
  }
  return { kind: isSlides ? "ppt" : "notes" };
}
