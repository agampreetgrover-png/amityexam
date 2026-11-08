import { describe, expect, it } from "vitest";
import { validateBackup } from "./db";

const backup = (data: Record<string, unknown[]>) => ({ app: "amityexams", version: 1, data });

describe("validateBackup text fields", () => {
  it("accepts rows whose text fields are strings", () => {
    expect(() => validateBackup(backup({ subjects: [{ id: 1, name: "DBMS", color: "#4f46e5", createdAt: 1 }] }))).not.toThrow();
  });

  it("refuses a subject whose name isn't text (it would crash every page that sorts subjects)", () => {
    expect(() => validateBackup(backup({ subjects: [{ id: 1, name: 123, color: "#000", createdAt: 1 }] }))).toThrow(/subjects/);
  });

  it("refuses a material whose text is an object", () => {
    expect(() => validateBackup(backup({ materials: [{ id: 1, subjectId: 1, fileName: "a.pdf", text: {}, createdAt: 1 }] }))).toThrow(/materials/);
  });

  it("refuses a chat message with no content", () => {
    expect(() => validateBackup(backup({ messages: [{ id: 1, subjectId: 1, role: "user", createdAt: 1 }] }))).toThrow(/messages/);
  });
});

describe("validateBackup repairs", () => {
  it("gives a quiz with missing or wrong-shaped fields the arrays and score the Quiz tab reads", () => {
    const q1 = { type: "mcq", question: "Q1", answer: "A", explanation: {} };
    const data = validateBackup(backup({
      quizzes: [
        { subjectId: 1, score: 50, createdAt: 1 },
        { subjectId: 1, score: "x", createdAt: 1, topicIds: [2, "3", -1], questions: [null, q1, { question: 1, answer: "A" }], responses: ["skipped", 7] },
      ],
    }));
    expect(data.quizzes[0]).toMatchObject({ questions: [], responses: [], topicIds: [], score: 50 });
    expect(data.quizzes[1]).toMatchObject({ questions: [{ question: "Q1", answer: "A", explanation: undefined }], responses: [""], topicIds: [2], score: 0 });
  });

  it("drops chat sources that aren't a list of labelled sources", () => {
    const good = { kind: "notes", label: "unit1.pdf" };
    const data = validateBackup(backup({
      messages: [
        { subjectId: 1, role: "assistant", content: "a", createdAt: 1, sources: "x" },
        { subjectId: 1, role: "assistant", content: "b", createdAt: 1, sources: [good, { kind: "pyq" }, null] },
      ],
    }));
    expect(data.messages[0].sources).toBeUndefined();
    expect(data.messages[1].sources).toEqual([good]);
  });
});
