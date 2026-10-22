// Subject matching against the real folder names in the two Drive sources (snapshot, 2026-10).
import { describe, expect, it } from "vitest";
import { bestSubject, pickFolders, type SubjectRef } from "./classify";
import { findCode, parseCourse } from "./catalog";

const LIBRARY = [
  "AIML202 - Machine Learning Theory Applications", "AIML203 - Deep Neural Networks", "AIML303 - Generative Artificial Intelligence",
  "AIML403 - Large Language Models", "BC105 - Technical Communication 1", "BC106 - Technical Communication 2",
  "CHEM101 - Applied Chemistry", "CHEM105 - General Chemistry", "CHEM136 - Engineering Chemistry",
  "CSE201 - Database Management Systems", "CSE202 - Operating System", "CSE303 - Analysis & Design of Algorithms",
  "CSE313 - Fundamentals of Machine Learning", "CSE314 - Cloud Computing Practitioner", "CSE326 - Introduction to AI & Machine Learning",
  "CSE336 - Essentials of Cyber Security", "CSE401 - Artificial Intelligence", "CSE439 - Cloud Security",
  "MATH114 - Applied Mathematics 1", "MATH122 - Applied Mathematics 2", "MATH211 - Applied Mathematics 3", "MATH242 - Applied Mathematics 4",
  "PHYS130 - Basic Physics - I for Bio Sciences", "PHYS131 - Basic Physics - II for Bio Sciences",
  "SKE301 - Aptitude & Reasoning Ability", "SMO313 - Machine Learning with Python",
];
const SEMESTER = ["ADAA", "Behavioural Sciences", "DBMS", "EN", "PYQs", "SKE"];
/** Folders sync would take for a subject, source by source, as in syncDrive. */
const matches = (s: SubjectRef) =>
  [LIBRARY, SEMESTER].flatMap((src) => (pickFolders(src.map((name) => ({ name })), [s]).picked.get(s.id) ?? []).map((f) => f.name));
const sub = (name: string, code?: string): SubjectRef => ({ id: 1, name, code });

describe("matching real Drive folders (subjects without a course code)", () => {
  it("keeps numbered parts apart", () => {
    expect(matches(sub("Technical Communication 2"))).toEqual(["BC106 - Technical Communication 2"]);
    expect(matches(sub("Applied Mathematics 3"))).toEqual(["MATH211 - Applied Mathematics 3"]);
    expect(matches(sub("Basic Physics II for Bio Sciences"))).toEqual(["PHYS131 - Basic Physics - II for Bio Sciences"]);
  });

  it("doesn't confuse similar subjects", () => {
    expect(matches(sub("Applied Chemistry"))).toEqual(["CHEM101 - Applied Chemistry"]);
    expect(matches(sub("Cloud Security"))).toEqual(["CSE439 - Cloud Security"]);
    expect(matches(sub("Artificial Intelligence"))).toEqual(["CSE401 - Artificial Intelligence"]);
    expect(matches(sub("Machine Learning"))).not.toContain("CSE326 - Introduction to AI & Machine Learning");
  });

  it("matches the library folder and the semester folder for the same subject", () => {
    expect(matches(sub("Database Management Systems"))).toEqual(["CSE201 - Database Management Systems", "DBMS"]);
    expect(matches(sub("Analysis & Design of Algorithms"))).toEqual(["CSE303 - Analysis & Design of Algorithms", "ADAA"]);
  });

  it("treats Design and Analysis of Algorithm(s) as Analysis & Design of Algorithms", () => {
    const both = ["CSE303 - Analysis & Design of Algorithms", "ADAA"];
    expect(matches(sub("Design and Analysis of Algorithm"))).toEqual(both);
    expect(matches(sub("Design & Analysis of Algorithms"))).toEqual(both);
    expect(matches(sub("Analysis and Design of Algorithm"))).toEqual(both);
    expect(matches(sub("Analysis & Design of Algorithms", "CSE303"))).toEqual(both);
    // Past papers under either short form go to the subject.
    for (const file of ["DAA Major 2022.pdf", "ADA - Major 2021.pdf", "Design and Analysis of Algorithm 2023.pdf"]) {
      expect(bestSubject(file, [sub("Analysis & Design of Algorithms"), { id: 2, name: "Database Management Systems" }])?.id).toBe(1);
    }
  });

  it("matches a subject typed as an acronym", () => {
    expect(matches(sub("DBMS"))).toEqual(["CSE201 - Database Management Systems", "DBMS"]);
  });
});

describe("matching with a course code", () => {
  it("is decided by the code for library folders", () => {
    expect(matches(sub("Technical Communication", "BC105"))).toEqual(["BC105 - Technical Communication 1"]);
  });
  it("matches a semester folder named after the code letters", () => {
    expect(matches(sub("Aptitude & Reasoning Ability", "SKE301"))).toEqual(["SKE301 - Aptitude & Reasoning Ability", "SKE"]);
  });
});

describe("course code auto-fill on real names", () => {
  const catalog = LIBRARY.map((n) => parseCourse(n)!);
  it("picks the right numbered part", () => {
    expect(findCode("Applied Mathematics 2", catalog)).toBe("MATH122");
    expect(findCode("Applied Mathematics II", catalog)).toBe("MATH122");
    expect(findCode("Technical Communication 1", catalog)).toBe("BC105");
  });
  it("fills the code for either name of a subject", () => {
    expect(findCode("Design and Analysis of Algorithm", catalog)).toBe("CSE303");
    expect(findCode("DAA", catalog)).toBe("CSE303");
  });
  it("leaves the code empty when the name fits several courses", () => {
    expect(findCode("Technical Communication", catalog)).toBeUndefined();
    expect(findCode("Applied Mathematics", catalog)).toBeUndefined();
    expect(findCode("Machine Learning", catalog)).toBeUndefined();
  });
  it("still fills well-known short forms", () => {
    expect(findCode("DBMS", catalog)).toBe("CSE201");
  });
});

describe("pickFolders", () => {
  it("gives each folder to one subject and leaves ties for the student", () => {
    const subjects = [sub("Machine Learning"), { id: 2, name: "Deep Neural Networks" }];
    const { picked, ambiguous } = pickFolders(LIBRARY.map((name) => ({ name })), subjects);
    expect(picked.get(2)?.map((f) => f.name)).toEqual(["AIML203 - Deep Neural Networks"]);
    // "Fundamentals of Machine Learning" and "Machine Learning with Python" fit equally well.
    expect(picked.has(1)).toBe(false);
    expect(ambiguous.get(1)?.map((f) => f.name)).toEqual(["CSE313 - Fundamentals of Machine Learning", "SMO313 - Machine Learning with Python"]);
  });
  it("does not assign a folder that two subjects fit equally", () => {
    const { picked } = pickFolders([{ name: "Cloud" }], [{ id: 1, name: "Cloud Security" }, { id: 2, name: "Cloud Computing" }]);
    expect(picked.size).toBe(0);
  });
});
