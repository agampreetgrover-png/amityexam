import { describe, expect, it } from "vitest";
import { chatTitle, matchingPyqs, noteExcerpts, prepSummary, starterQuestions, type PrepInput } from "./study-chat";
import type { PyqQuestion } from "./types";

const q = (id: number, text: string, extra: Partial<PyqQuestion> = {}): PyqQuestion =>
  ({ id, subjectId: 1, materialId: 1, number: `Q${id}`, text, ...extra });

const topics = [
  { id: 10, title: "Normalization" },
  { id: 11, title: "ER model" },
];

describe("noteExcerpts", () => {
  const notes = [
    { fileName: "Unit 2 normalization.pdf", text: "Normalization removes redundancy.\n\nFirst normal form requires atomic values." },
    { fileName: "Unit 1 ER.pdf", text: "An ER model has entities and relationships." },
  ];
  it("heads each excerpt with its file and lists the files used", () => {
    const r = noteExcerpts(notes, "explain normalization for 10 marks", 5000);
    expect(r.files).toEqual(["Unit 2 normalization.pdf"]);
    expect(r.text).toContain("[Notes: Unit 2 normalization.pdf]");
  });
  it("ignores how-to-answer words, so they don't match every file", () => {
    expect(noteExcerpts(notes, "write a 10 marks answer", 5000).files).toEqual([]);
  });
});

describe("matchingPyqs", () => {
  const qs = [
    q(1, "Explain 2NF and 3NF with examples.", { year: 2023, marks: 10, topicId: 10 }),
    q(2, "Explain 2NF and 3NF with examples.", { year: 2021, marks: 10, topicId: 10 }),
    q(3, "Draw an ER diagram for a library.", { year: 2022, marks: 5, topicId: 11 }),
    q(4, "What is a dependency? Define BCNF.", { year: 2020, marks: 5, topicId: 10 }),
  ];
  it("finds questions through their topic, merges repeats and counts how often the topic is asked", () => {
    const r = matchingPyqs(qs, topics, "teach me normalization");
    expect(r.picked.map((p) => p.id).sort()).toEqual([1, 4]);
    expect(r.text).toContain("also asked: 2021");
    expect(r.text).toContain("Normalization: asked 3 times (2020, 2021, 2023), 5–10 marks");
    expect(r.text).not.toContain("ER diagram");
  });
  it("returns nothing for an empty query", () => {
    expect(matchingPyqs(qs, topics, "the and of").picked).toEqual([]);
  });
});

describe("prep summary and starters", () => {
  const prep: PrepInput = {
    subjectName: "DBMS",
    mode: "mid-term",
    exam: { date: "2026-11-02" },
    today: "2026-10-27",
    topics: [
      { id: 10, title: "Normalization", status: "not-started", confidence: 3 },
      { id: 11, title: "ER model", status: "studied", confidence: 1 },
    ],
    questions: [{ topicId: 10 }, { topicId: 10 }, { topicId: 11 }],
  };
  it("says when the exam is, what's asked most and what's weak", () => {
    const s = prepSummary(prep);
    expect(s).toContain("Mid-sem exam on Mon, 2 Nov (in 6 days)");
    expect(s).toContain("Normalization (2×), ER model (1×)");
    expect(s).toContain("hard: ER model");
    expect(s).toContain("1 of 2 topics studied");
  });
  it("suggests prep-tuned openers", () => {
    expect(starterQuestions(prep)).toEqual([
      "What are the most asked questions in DBMS?",
      "Explain Normalization as a 10-mark answer",
      "I find ER model hard. Teach it to me from the notes",
      "Quiz me on ER model with 5 quick questions",
    ]);
  });
});

it("titles a chat from its first question", () => {
  expect(chatTitle("  what   is 3NF? ")).toBe("what is 3NF?");
  expect(chatTitle("x".repeat(80))).toHaveLength(58);
});
