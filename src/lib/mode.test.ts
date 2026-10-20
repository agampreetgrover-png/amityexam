import { describe, expect, it } from "vitest";
import { aiModeFields, examInMode, examTypeMode, pyqMatchesMode, topicsInScope, unitInScope } from "./mode";
import type { ExamMode, ExamType, Topic, Unit } from "./types";

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

describe("unitInScope", () => {
  it("matches a unit's own syllabus to the mode, with untagged (legacy) units counting as major", () => {
    const units = [unit(1, "mid-term"), unit(2, "end-term"), unit(3)];
    expect(units.map((u) => unitInScope(u, "mid-term"))).toEqual([true, false, false]);
    expect(units.map((u) => unitInScope(u, "end-term"))).toEqual([false, true, true]);
  });

  it("includes everything when no mode is chosen", () => {
    expect(unitInScope(unit(1, "mid-term"))).toBe(true);
    expect(unitInScope(unit(2))).toBe(true);
  });
});

describe("topicsInScope", () => {
  const units = [unit(1, "mid-term"), unit(2, "mid-term"), unit(3, "end-term"), unit(4), unit(5, "mid-term", 2)];
  const topics = [topic(1, 1), topic(2, 2), topic(3, 3), topic(4, 4), topic(5, 5), topic(6, 99)];

  it("keeps only the mode's syllabus, across subjects", () => {
    expect(topicsInScope(topics, units, "mid-term").map((t) => t.id)).toEqual([1, 2, 5]);
  });

  it("counts topics of untagged or unknown units as major", () => {
    expect(topicsInScope(topics, units, "end-term").map((t) => t.id)).toEqual([3, 4, 6]);
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
    expect(aiModeFields("end-term", units)).toEqual({ examMode: "end-term", scopeUnits: ["U3"] });
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
