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

describe("validateBackup repairs quizzes and topic progress", () => {
  it("fills in a quiz's missing fields instead of letting the weak-topic list crash on it", () => {
    const data = validateBackup(
      backup({
        quizzes: [
          { id: 1, subjectId: 1, score: 140, createdAt: 5 },
          {
            id: 2, subjectId: 1, topicIds: [3, "x", -1], score: "high", responses: ["a", 7],
            questions: [{ type: "mcq", question: "Q?", answer: "A", options: ["A", 2] }, { question: 1, answer: "B" }, "junk"],
          },
        ],
      }),
    );
    const [a, b] = data.quizzes;
    expect(a).toMatchObject({ topicIds: [], questions: [], responses: [], score: 100, createdAt: 5 });
    expect(b).toMatchObject({ topicIds: [3], score: 0, responses: ["a", ""], createdAt: 0 });
    expect(b.questions).toEqual([{ type: "mcq", question: "Q?", answer: "A", options: ["A"] }]);
  });

  it("puts an unreadable topic confidence or status back to a sensible value", () => {
    const data = validateBackup(
      backup({
        topics: [
          { id: 1, subjectId: 1, unitId: 1, title: "Joins", confidence: 9, status: "done" },
          { id: 2, subjectId: 1, unitId: 1, title: "Keys", confidence: "low", status: "revised" },
        ],
      }),
    );
    expect(data.topics.map((t) => [t.confidence, t.status])).toEqual([[5, "not-started"], [3, "revised"]]);
  });
});
