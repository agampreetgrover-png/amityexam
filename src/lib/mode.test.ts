import { describe, expect, it } from "vitest";
import { aiModeFields, examInMode, examSyllabus, examTypeMode, materialsForMode, pyqMatchesMode, pyqMode, topicsInScope, unitInScope } from "./mode";
import type { Exam, ExamMode, ExamType, Topic, Unit } from "./types";

const unit = (id: number, exam?: ExamMode, subjectId = 1): Unit => ({ id, subjectId, title: `U${id}`, order: id, exam });
const topic = (id: number, unitId: number): Pick<Topic, "id" | "unitId"> => ({ id, unitId });

describe("examInMode", () => {
  const types: ExamType[] = ["internal", "mid-term", "end-term", "practical", "viva", "other"];
  const inMode = (mode: ExamMode) => types.filter((type) => examInMode({ type }, mode));

  it("splits exam types between the two seasons, with other in both", () => {
    expect(inMode("mid-term")).toEqual(["internal", "mid-term", "other"]);
    expect(inMode("end-term")).toEqual(["end-term", "practical", "viva", "other"]);
  });

  it("includes everything when no mode is chosen", () => {
    expect(types.every((type) => examInMode({ type }))).toBe(true);
  });
});

describe("examTypeMode", () => {
  it("maps exam types to their season, leaving other open", () => {
    expect(examTypeMode("internal")).toBe("mid-term");
    expect(examTypeMode("mid-term")).toBe("mid-term");
    expect(examTypeMode("viva")).toBe("end-term");
    expect(examTypeMode("other")).toBeUndefined();
  });
});

describe("examSyllabus", () => {
  const units = [unit(1, "mid-term"), unit(2), unit(3, "mid-term", 2)];
  const t = (id: number, unitId: number, subjectId = 1) => ({ ...topic(id, unitId), subjectId }) as Topic;
  const topics = [t(1, 1), t(2, 2), t(3, 3, 2)];
  const exam = (type: ExamType, topicIds: number[] = []): Exam => ({ subjectId: 1, type, date: "2026-11-01", topicIds, checklist: [] });
  const ids = (list: Topic[]) => list.map((x) => x.id);

  it("uses the ticked topics when an exam lists them", () => {
    expect(ids(examSyllabus(exam("end-term", [2]), topics, units))).toEqual([2]);
  });

  it("otherwise covers the subject's syllabus for the exam's season", () => {
    expect(ids(examSyllabus(exam("mid-term"), topics, units))).toEqual([1]);
    expect(ids(examSyllabus(exam("end-term"), topics, units))).toEqual([1, 2]);
  });

  it("follows the chosen mode for exams of type other", () => {
    expect(ids(examSyllabus(exam("other"), topics, units, "mid-term"))).toEqual([1]);
    expect(ids(examSyllabus(exam("other"), topics, units))).toEqual([1, 2]);
  });
});

describe("unitInScope", () => {
  it("treats the mid-sem syllabus as part of the major one", () => {
    const units = [unit(1, "mid-term"), unit(2, "end-term"), unit(3)];
    expect(units.map((u) => unitInScope(u, "mid-term"))).toEqual([true, false, false]);
    expect(units.map((u) => unitInScope(u, "end-term"))).toEqual([true, true, true]);
  });

  it("includes everything when no mode is chosen", () => {
    expect(unitInScope(unit(1, "mid-term"))).toBe(true);
    expect(unitInScope(unit(2))).toBe(true);
  });
});

describe("topicsInScope", () => {
  const units = [unit(1, "mid-term"), unit(2, "mid-term"), unit(3, "end-term"), unit(4), unit(5, "mid-term", 2)];
  const topics = [topic(1, 1), topic(2, 2), topic(3, 3), topic(4, 4), topic(5, 5), topic(6, 99)];

  it("keeps only units marked mid-sem in mid-sem mode, across subjects", () => {
    expect(topicsInScope(topics, units, "mid-term").map((t) => t.id)).toEqual([1, 2, 5]);
  });

  it("keeps the whole syllabus in major mode, mid-sem units and unknown units included", () => {
    expect(topicsInScope(topics, units, "end-term").map((t) => t.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("keeps everything with no mode", () => {
    expect(topicsInScope(topics, units, undefined)).toHaveLength(6);
  });
});

describe("pyqMatchesMode", () => {
  it("matches past-paper names to the season", () => {
    for (const f of ["Minor 2023.pdf", "DBMS_midsem_22.pdf", "Mid-Term paper", "mst-mid.pdf"]) expect(pyqMatchesMode(f, "mid-term")).toBe(true);
    for (const f of ["Major-2024.pdf", "EndSem DBMS", "end_term_2021.pdf"]) expect(pyqMatchesMode(f, "end-term")).toBe(true);
    expect(pyqMatchesMode("Major-2024.pdf", "mid-term")).toBe(false);
    expect(pyqMatchesMode("pyramid notes.pdf", "mid-term")).toBe(false);
    expect(pyqMatchesMode("legend.pdf", "end-term")).toBe(false);
    expect(pyqMatchesMode("paper.pdf", undefined)).toBe(false);
  });
});

describe("aiModeFields", () => {
  const units = [unit(1, "mid-term"), unit(2, "mid-term"), unit(3)];
  it("names the units of the mode's syllabus", () => {
    expect(aiModeFields("mid-term", units)).toEqual({ examMode: "mid-term", scopeUnits: ["U1", "U2"] });
    expect(aiModeFields("end-term", units)).toEqual({ examMode: "end-term", scopeUnits: ["U1", "U2", "U3"] });
    expect(aiModeFields(undefined, units)).toEqual({});
  });
});

describe("pyqMatchesMode with Drive tags", () => {
  it("prefers the Drive tag over the file name", () => {
    expect(pyqMatchesMode({ fileName: "DBMS PYQ 2018.pdf", pyqExam: "mid-term" }, "mid-term")).toBe(true);
    expect(pyqMatchesMode({ fileName: "Major paper.pdf", pyqExam: "mid-term" }, "end-term")).toBe(false);
  });
  it("falls back to the file name when untagged", () => {
    expect(pyqMatchesMode({ fileName: "Minor 2023.pdf" }, "mid-term")).toBe(true);
  });
});

describe("pyqMode / strict mode matching", () => {
  it("treats papers with no hint as unknown for both modes", () => {
    for (const f of ["DBMS PYQ 2018.pdf", "Set-1 [AIML202].pdf", "paper.pdf"]) {
      expect(pyqMatchesMode(f, "mid-term")).toBe(false);
      expect(pyqMatchesMode(f, "end-term")).toBe(false);
      expect(pyqMatchesMode({ fileName: f }, "end-term")).toBe(false);
    }
  });
  it("treats names with both major and minor words as unknown", () => {
    expect(pyqMode("Major and Minor papers 2022.pdf")).toBeUndefined();
    expect(pyqMatchesMode("Major and Minor papers 2022.pdf", "mid-term")).toBe(false);
    expect(pyqMatchesMode("Major and Minor papers 2022.pdf", "end-term")).toBe(false);
  });
  it("only matches whole words", () => {
    expect(pyqMode("Middleware notes.pdf")).toBeUndefined();
    expect(pyqMode("Weekend revision.pdf")).toBeUndefined();
    expect(pyqMode("Minority report.pdf")).toBeUndefined();
    expect(pyqMode("DBMS Mid Semester 2023.pdf")).toBe("mid-term");
    expect(pyqMode("End Semester 2021.pdf")).toBe("end-term");
  });
  it("lets the tag override an ambiguous or opposite name", () => {
    expect(pyqMode({ fileName: "Major and Minor.pdf", pyqExam: "end-term" })).toBe("end-term");
    expect(pyqMatchesMode({ fileName: "Minor 2023.pdf", pyqExam: "end-term" }, "mid-term")).toBe(false);
  });
});

describe("materialsForMode", () => {
  const m = (kind: "notes" | "pyq", fileName: string, pyqExam?: ExamMode) => ({ kind, fileName, pyqExam });
  const all = [m("notes", "Unit 1.pdf"), m("pyq", "Major 2021.pdf"), m("pyq", "Minor 2023.pdf"), m("pyq", "DBMS PYQ 2018.pdf"), m("pyq", "x.pdf", "mid-term")];
  it("keeps notes and only this exam's past papers", () => {
    expect(materialsForMode(all, "end-term").map((x) => x.fileName)).toEqual(["Unit 1.pdf", "Major 2021.pdf"]);
    expect(materialsForMode(all, "mid-term").map((x) => x.fileName)).toEqual(["Unit 1.pdf", "Minor 2023.pdf", "x.pdf"]);
  });
});

describe("aiModeFields caps", () => {
  it("clips to the request schema limits", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ ...unit(i, "mid-term"), title: "x".repeat(400) }));
    const f = aiModeFields("mid-term", many) as { scopeUnits: string[] };
    expect(f.scopeUnits).toHaveLength(50);
    expect(f.scopeUnits[0]).toHaveLength(300);
  });
});
