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

export type SyllabusResult = z.infer<typeof SyllabusSchema>;
export type QuizResult = z.infer<typeof QuizSchema>;
export type GradeResult = z.infer<typeof GradeSchema>;

export const JSON_ACTIONS = ["syllabus", "quiz", "grade"] as const;
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
