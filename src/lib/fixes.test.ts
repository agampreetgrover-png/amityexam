import { describe, expect, it } from "vitest";
import { matchOption } from "../components/subject/quiz-match";
import { GradeSchema } from "./ai/schemas";
import { classify } from "./drive/classify";
import { parseSyllabus, parseTopics } from "./syllabus-text";

// Regression tests for the bugs fixed in the 2026-10 review.

describe("matchOption with numbered answer keys", () => {
  const opts = ["O(n^2)", "O(n)", "O(log n)", "O(1)"];
  it("maps a bare number to that option, not to an option containing the digit", () => {
    expect(matchOption("2", opts)).toBe("O(n)");
    expect(matchOption("(4)", opts)).toBe("O(1)");
  });
  it("still prefers an option whose text is the number", () => {
    expect(matchOption("2", ["10", "2", "3", "4"])).toBe("2");
  });
});

describe("GradeSchema scores", () => {
  it("scales percentages down instead of zeroing them", () => {
    const r = GradeSchema.parse({ results: [{ score: 80, feedback: "" }, { score: "0.5", feedback: "" }, { score: "75%", feedback: "" }, { score: -3, feedback: "" }] });
    expect(r.results.map((x) => x.score)).toEqual([0.8, 0.5, 0.75, 0]);
  });
});

describe("syllabus parsing", () => {
  it("doesn't hang on long space padding (catastrophic backtracking)", () => {
    const start = performance.now();
    parseSyllabus("Unit 1\nTopic" + " ".repeat(5000) + "x");
    expect(performance.now() - start).toBeLessThan(500);
  });
  it("still strips weightage at the end of a line", () => {
    expect(parseSyllabus("Unit 1\nPaging (20%)\nSegmentation [8 hours]")[0].topics.map((t) => t.title)).toEqual(["Paging", "Segmentation"]);
  });
  it("keeps the whole number of a numbered sub-heading out of the title", () => {
    expect(parseTopics("1.1 Introduction to OS\n2.3.1 Paging\nX.25 protocol")).toEqual(["Introduction to OS", "Paging", "X.25 protocol"]);
  });
  it("treats section words as headings only when they stand alone", () => {
    const units = parseSyllabus("Unit I\nClasses, objects\nReferences and pointers\nTemplates\nText Books:\nGalvin, OS Concepts");
    expect(units[0].topics.map((t) => t.title)).toEqual(["Classes", "objects", "References and pointers", "Templates"]);
  });
});

describe("classify with underscores and run-together words", () => {
  it("recognises past papers", () => {
    expect(classify("DBMS_Minor_2023.pdf", [], "file")).toEqual({ kind: "pyq", pyqExam: "mid-term" });
    expect(classify("CSE301_Major_2022.pdf", [], "file")).toEqual({ kind: "pyq", pyqExam: "end-term" });
    expect(classify("Endsem2021.pdf", [], "file")).toEqual({ kind: "pyq", pyqExam: "end-term" });
  });
  it("skips lab manuals", () => {
    expect(classify("OS_Lab_Manual.pdf", [], "file")).toBeNull();
  });
});
