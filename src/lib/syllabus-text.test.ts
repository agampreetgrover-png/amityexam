import { describe, expect, it } from "vitest";
import { parseSyllabus, parseTopics } from "./syllabus-text";

describe("parseTopics", () => {
  it("takes one topic per line and drops blanks", () => {
    expect(parseTopics("ER model\n\n  Normalization  \r\nSQL joins\n")).toEqual(["ER model", "Normalization", "SQL joins"]);
  });

  it("strips list markers pasted from a syllabus", () => {
    expect(parseTopics("1. ER model\n2) Keys\n- Joins\n• Views\n(a) Triggers\nii. Indexing")).toEqual([
      "ER model", "Keys", "Joins", "Views", "Triggers", "Indexing",
    ]);
  });

  it("keeps titles that only look like markers", () => {
    expect(parseTopics("C++ basics\nI/O systems\n3NF and BCNF")).toEqual(["C++ basics", "I/O systems", "3NF and BCNF"]);
  });

  it("removes repeats regardless of case", () => {
    expect(parseTopics("Deadlocks\ndeadlocks\nPaging")).toEqual(["Deadlocks", "Paging"]);
  });
});

const titles = (text: string) => parseSyllabus(text).map((u) => [u.title, u.topics.map((t) => t.title)]);

describe("parseSyllabus", () => {
  it("starts a unit at each Unit/Module heading and splits topics on commas", () => {
    expect(titles("Module I: Introduction (20%)\nOS functions, system calls, threads.\nUNIT - II Scheduling\n1. FCFS\n2. Round robin")).toEqual([
      ["Module I: Introduction", ["OS functions", "system calls", "threads"]],
      ["UNIT - II Scheduling", ["FCFS", "Round robin"]],
    ]);
  });

  it("keeps commas inside brackets and drops weightage", () => {
    expect(titles("Unit 1\nPaging (with TLB, inverted tables); segmentation 25%")).toEqual([
      ["Unit 1", ["Paging (with TLB, inverted tables)", "segmentation"]],
    ]);
  });

  it("puts topics without a heading in one unit", () => {
    expect(titles("ER model\nKeys, joins")).toEqual([["Unit 1", ["ER model", "Keys", "joins"]]]);
  });

  it("reads Markdown tables from a photo transcription", () => {
    expect(titles("| Module | Content | Weightage |\n| :--- | :--- | :--- |\n| **Module I: Introduction** | OS functions, system calls | 20% |\n| Module II: Deadlocks | Prevention, avoidance | 25% |")).toEqual([
      ["Module I: Introduction", ["OS functions", "system calls"]],
      ["Module II: Deadlocks", ["Prevention", "avoidance"]],
    ]);
  });

  it("skips text books and references until the next unit", () => {
    expect(titles("Unit 1\nDeadlocks\nText Books:\nGalvin, OS Concepts\nUnit 2: Memory\nPaging")).toEqual([
      ["Unit 1", ["Deadlocks"]],
      ["Unit 2: Memory", ["Paging"]],
    ]);
  });
});
