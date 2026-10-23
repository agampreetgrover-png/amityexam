import { describe, expect, it } from "vitest";
import type { PyqQuestion, Topic, Unit } from "../types";
import { groupByTopic, groupByYear, hotThreshold, naturalCompare, needsMapping, newestFirst, papersForMode, paperYear, questionsOf, unknownExamPapers } from "./group";

const paper = (id: number, fileName: string, extra: object = {}) => ({ id, fileName, ...extra });
const q = (id: number, materialId: number, number: string, extra: Partial<PyqQuestion> = {}): PyqQuestion => ({
  id, subjectId: 1, materialId, number, text: `question ${id}`, ...extra,
});
const unit = (id: number, title: string): Unit => ({ id, subjectId: 1, title, order: id });
const topic = (id: number, unitId: number, title: string): Topic => ({
  id, subjectId: 1, unitId, title, confidence: 3, status: "not-started",
});

describe("paper year and exam", () => {
  it("prefers the year read from the paper, else the file name", () => {
    expect(paperYear({ fileName: "DBMS Major 2018 Apr.pdf" })).toBe(2018);
    expect(paperYear({ fileName: "DBMS Major 2018.pdf", paperYear: 2019 })).toBe(2019);
    expect(paperYear({ fileName: "Minor Exam QP DBMS 2025-1.pdf" })).toBe(2025);
    expect(paperYear({ fileName: "Set-1 [AIML202].pdf" })).toBeUndefined();
  });

});

describe("strict exam split", () => {
  const ps = [
    paper(1, "DBMS Major 2021.pdf"),
    paper(2, "Minor Exam QP DBMS 2025.pdf"),
    paper(3, "Set-1.pdf"), // nothing says which exam
    paper(4, "DBMS PYQ 2018.pdf", { pyqExam: "mid-term" }), // tag wins over the name
    paper(5, "Mid and End sem combined.pdf"), // ambiguous name
  ];

  it("never shows a mid-sem paper under major, or the reverse", () => {
    expect(papersForMode(ps, "end-term").map((p) => p.id)).toEqual([1]);
    expect(papersForMode(ps, "mid-term").map((p) => p.id)).toEqual([2, 4]);
  });

  it("keeps papers of unknown exam type out of both modes", () => {
    const unknown = unknownExamPapers(ps).map((p) => p.id);
    expect(unknown).toEqual([3, 5]);
    for (const mode of ["mid-term", "end-term"] as const) {
      expect(papersForMode(ps, mode).some((p) => unknown.includes(p.id))).toBe(false);
    }
  });

  it("limits questions to the shown papers", () => {
    const qs = [q(1, 1, "Q1"), q(2, 2, "Q1"), q(3, 3, "Q1")];
    expect(questionsOf(qs, papersForMode(ps, "end-term")).map((x) => x.id)).toEqual([1]);
  });
});

describe("year-wise grouping", () => {
  it("orders newest first with unknown years last", () => {
    const ps = [paper(1, "DBMS 2015.pdf"), paper(2, "Set-1.pdf"), paper(3, "DBMS 2021.pdf")];
    expect(newestFirst(ps).map((p) => p.id)).toEqual([3, 1, 2]);
  });

  it("groups papers by year with questions in printed order", () => {
    const ps = [paper(1, "A 2021.pdf"), paper(2, "B 2021.pdf"), paper(3, "C 2018.pdf")];
    const qs = [q(1, 1, "Q10"), q(2, 1, "Q2(b)"), q(3, 1, "Q2(a)"), q(4, 3, "Q1")];
    const groups = groupByYear(ps, qs);
    expect(groups.map((g) => g.year)).toEqual([2021, 2018]);
    expect(groups[0].papers.map((p) => p.paper.id)).toEqual([1, 2]);
    expect(groups[0].papers[0].questions.map((x) => x.number)).toEqual(["Q2(a)", "Q2(b)", "Q10"]);
    expect(naturalCompare("Q2", "Q10")).toBeLessThan(0);
  });
});

describe("topic-wise grouping", () => {
  const units = [unit(1, "Unit 1"), unit(2, "Unit 2")];
  const topics = [topic(10, 1, "ER model"), topic(11, 1, "Keys"), topic(20, 2, "Normalization")];

  it("counts, year spans and marks per topic in syllabus order", () => {
    const qs = [
      q(1, 1, "Q1", { topicId: 20, year: 2018, marks: 10 }),
      q(2, 2, "Q3", { topicId: 20, year: 2022, marks: 5 }),
      q(3, 2, "Q4", { topicId: 10, year: 2022 }),
      q(4, 2, "Q5", { topicId: null, year: 2022 }),
      q(5, 2, "Q6", { year: 2022 }),
    ];
    const g = groupByTopic(qs, units, topics);
    expect(g.units.map((u) => u.unit.id)).toEqual([1, 2]);
    const norm = g.units[1].topics[0];
    expect(norm).toMatchObject({ count: 2, years: [2018, 2022], marks: 15 });
    expect(norm.questions.map((x) => x.year)).toEqual([2022, 2018]); // newest first
    expect(g.notInSyllabus.map((x) => x.id)).toEqual([4]);
    expect(g.unmatched.map((x) => x.id)).toEqual([5]);
    expect(g.neverAsked.map((t) => t.id)).toEqual([11]);
  });

  it("re-matches questions whose topic was deleted instead of calling them off-syllabus", () => {
    const g = groupByTopic([q(1, 1, "Q1", { topicId: 99 })], units, topics);
    expect(g.notInSyllabus).toHaveLength(0);
    expect(g.unmatched).toHaveLength(1);
    expect(needsMapping({ topicId: 99 }, new Set([10]))).toBe(true);
    expect(needsMapping({ topicId: null }, new Set([10]))).toBe(false);
    expect(needsMapping({ topicId: 10 }, new Set([10]))).toBe(false);
  });

  it("flags the most-asked quarter of topics, never one-offs", () => {
    expect(hotThreshold([1, 1, 1])).toBe(2);
    expect(hotThreshold([8, 5, 3, 2, 1, 1, 1, 1])).toBe(5);
    expect(hotThreshold([])).toBe(Infinity);
    const qs = [1, 2, 3].map((i) => q(i, 1, `Q${i}`, { topicId: 20 })).concat([q(4, 1, "Q4", { topicId: 10 })]);
    const g = groupByTopic(qs, units, topics);
    expect(g.units.flatMap((u) => u.topics).filter((t) => t.hot).map((t) => t.topic.id)).toEqual([20]);
  });
});
