import { describe, expect, it } from "vitest";
import { GradeSchema, QuizSchema } from "./schemas";

describe("null optional fields from the model", () => {
  it("accepts null options and explanation in a quiz", () => {
    const r = QuizSchema.safeParse({
      questions: [
        { type: "short", question: "Define paging.", options: null, answer: "x", explanation: null },
        { type: "mcq", question: "Q?", options: ["a", "b"], answer: "a" },
      ],
    });
    expect(r.success).toBe(true);
    expect(r.data?.questions[0].options).toBeUndefined();
    expect(r.data?.questions[0].explanation).toBeUndefined();
    expect(r.data?.questions[1].options).toEqual(["a", "b"]);
  });

  it("accepts null feedback in a grade", () => {
    const r = GradeSchema.safeParse({ results: [{ score: 1, feedback: null }, { score: 0.5, feedback: "ok" }] });
    expect(r.success).toBe(true);
    expect(r.data?.results.map((x) => x.feedback)).toEqual(["", "ok"]);
  });

  it("still rejects a non-string feedback", () => {
    expect(GradeSchema.safeParse({ results: [{ score: 1, feedback: 3 }] }).success).toBe(false);
  });
});
