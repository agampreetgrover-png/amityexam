import { z } from "zod";

// Shared between the API route (validating model output) and the client (typing results).

export const SyllabusSchema = z.object({
  units: z.array(
    z.object({
      title: z.string(),
      topics: z.array(z.object({ title: z.string(), difficulty: z.coerce.number().min(1).max(5).catch(3) })),
    }),
  ),
});

export const QuizSchema = z.object({
  questions: z.array(
    z.object({
      type: z.enum(["mcq", "short"]).catch("mcq"),
      question: z.string(),
      options: z.array(z.string()).optional(),
      answer: z.string(),
      explanation: z.string().optional(),
    }),
  ),
});

export const GradeSchema = z.object({
  results: z.array(z.object({ score: z.coerce.number().min(0).max(1).catch(0), feedback: z.string() })),
});

// Models return numbers as strings ("4 marks", "2021") or junk; coerce, and fall back to null.
const intOrNull = (min: number, max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" ? Number(v.match(/\d+(\.\d+)?/)?.[0] ?? NaN) : v),
    z.number().int().min(min).max(max).nullable().catch(null),
  ).catch(null);
const strOrNull = z.preprocess((v) => (typeof v === "string" && v.trim() ? v.trim() : null), z.string().nullable()).catch(null);

/** Keep the items that parse; one malformed entry shouldn't sink the whole reply. */
const lenientArray = <T extends z.ZodTypeAny>(item: T) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((xs) => xs.flatMap((x) => {
      const r = item.safeParse(x);
      return r.success ? [r.data] : [];
    }));

const PyqQuestionSchema = z.object({
  number: z.preprocess((v) => (v == null ? "" : String(v).trim()), z.string()).catch(""),
  section: strOrNull.default(null),
  text: z.string().trim().min(1),
  marks: intOrNull(0, 100).default(null),
});

/** One past paper split into questions (action "pyq"). */
export const PyqPaperSchema = z.object({
  year: intOrNull(2000, 2100).default(null),
  exam: z.enum(["mid-term", "end-term"]).nullable().catch(null).default(null),
  questions: lenientArray(PyqQuestionSchema),
});

/** Questions mapped to syllabus topics by index (action "pyqmap"); t = -1 means no topic fits. */
export const PyqMapSchema = z.object({
  map: lenientArray(z.object({ i: z.coerce.number().int(), t: z.coerce.number().int().catch(-1) })),
});

// "2:30 PM", "14.30", "10:00" → "HH:mm"; anything else → null.
const timeOrNull = z.preprocess((v) => {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{1,2})[:.](\d{2})\s*([ap]\.?m\.?)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const pm = m[3]?.toLowerCase().startsWith("p");
  if (m[3] && h === 12) h = pm ? 12 : 0;
  else if (pm) h += 12;
  return h < 24 && Number(m[2]) < 60 ? `${String(h).padStart(2, "0")}:${m[2]}` : null;
}, z.string().nullable()).catch(null);

// A real calendar date in YYYY-MM-DD (rejects 2025-02-30 and the like).
const isoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => {
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().startsWith(d);
});

/** Exams found in a date sheet (action "datesheet"); subject indexes the request's topics, -1 = not one of the student's. */
export const DatesheetSchema = z.object({
  exams: lenientArray(
    z.object({
      subject: z.coerce.number().int().catch(-1),
      date: isoDate,
      time: timeOrNull.default(null),
      durationMins: intOrNull(10, 600).default(null),
      type: z.enum(["mid-term", "end-term", "internal", "practical", "viva", "other"]).catch("other"),
      venue: strOrNull.default(null),
    }),
  ),
});

export type SyllabusResult = z.infer<typeof SyllabusSchema>;
export type DatesheetResult = z.infer<typeof DatesheetSchema>;
export type PyqPaperResult = z.infer<typeof PyqPaperSchema>;
export type PyqMapResult = z.infer<typeof PyqMapSchema>;
export type QuizResult = z.infer<typeof QuizSchema>;
export type GradeResult = z.infer<typeof GradeSchema>;

export const JSON_ACTIONS = ["syllabus", "quiz", "grade", "pyq", "pyqmap", "datesheet"] as const;
export const TEXT_ACTIONS = ["summary", "cheatsheet", "predict", "chat", "explain"] as const;
export type JsonAction = (typeof JSON_ACTIONS)[number];
export type TextAction = (typeof TEXT_ACTIONS)[number];

/** Request body every action accepts; each prompt uses the fields it needs. Unknown fields are stripped. */
export const AiRequestSchema = z.object({
  subject: z.string().max(200).optional(),
  topics: z.array(z.string().max(300)).max(150).optional(),
  // Long material is truncated rather than rejected; the provider clips it further.
  context: z.string().transform((s) => s.slice(0, 400_000)).optional(), // extracted notes / PYQ text
  text: z.string().transform((s) => s.slice(0, 100_000)).optional(), // free input (syllabus text, question)
  count: z.coerce.number().int().transform((n) => Math.min(30, Math.max(1, n))).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  // Which exam the student is preparing for; mid-sem also names the units it covers.
  examMode: z.enum(["mid-term", "end-term"]).optional(),
  scopeUnits: z.array(z.string().max(300)).max(50).optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20_000) }))
    .max(20)
    .optional(),
  answers: z
    .array(z.object({ question: z.string().max(5000), expected: z.string().max(5000), given: z.string().max(5000) }))
    .max(30)
    .optional(),
});

export type AiRequest = z.infer<typeof AiRequestSchema>;
