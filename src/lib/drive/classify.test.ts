import { describe, expect, it } from "vitest";
import { classify, MATCH_THRESHOLD, subjectScore } from "./classify";

const dbms = { id: 1, name: "Database Management Systems", code: "CSE201" };
const dbmsNoCode = { id: 1, name: "Database Management Systems" };
const ada = { id: 2, name: "Analysis & Design of Algorithms" };
const cyber = { id: 3, name: "Essentials of Cyber Security" };

describe("subjectScore", () => {
  it("matches library folders by course code", () => {
    expect(subjectScore("CSE201 - Database Management Systems", dbms)).toBe(1);
    expect(subjectScore("CSE202 - Operating System", dbms)).toBe(0);
  });

  it("matches abbreviated folders and file names", () => {
    expect(subjectScore("DBMS", dbmsNoCode)).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(subjectScore("DBMS Major 2021.pdf", dbmsNoCode)).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(subjectScore("ADAA", ada)).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    expect(subjectScore("Cybersecurity Minor pdf.pdf", cyber)).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it("matches by name when the subject has no code but the folder does", () => {
    expect(subjectScore("CSE201 - Database Management Systems", dbmsNoCode)).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it("does not match unrelated subjects", () => {
    expect(subjectScore("Behavioural Sciences", dbmsNoCode)).toBeLessThan(MATCH_THRESHOLD);
    expect(subjectScore("networking_pyqs.pdf", dbmsNoCode)).toBeLessThan(MATCH_THRESHOLD);
    expect(subjectScore("SKE", ada)).toBeLessThan(MATCH_THRESHOLD);
  });
});

describe("classify", () => {
  it("tags past papers and their exam type", () => {
    expect(classify("DBMS Major 2021.pdf", ["DBMS"], "file")).toEqual({ kind: "pyq", pyqExam: "end-term" });
    expect(classify("Minor Exam QP DBMS 2025-1.pdf", ["DBMS"], "file")).toEqual({ kind: "pyq", pyqExam: "mid-term" });
    expect(classify("Set-1 [AIML202].pdf", ["PYQs"], "file")).toEqual({ kind: "pyq", pyqExam: undefined });
    expect(classify("2019.pdf", ["CSE201 - DBMS", "PYQs"], "file")?.kind).toBe("pyq");
  });

  it("sorts notes and slides", () => {
    expect(classify("DBMS - Module 1 (1).pdf", ["DBMS"], "file")).toEqual({ kind: "notes" });
    expect(classify("Module II_dbms_2024.pptx", ["DBMS"], "file")).toEqual({ kind: "ppt" });
    expect(classify("DBMS", ["DBMS"], "gdoc")).toEqual({ kind: "notes" });
  });

  it("skips books, labs, assignments, images and spreadsheets", () => {
    expect(classify("korth.pdf", ["CSE201", "Books"], "file")).toBeNull();
    expect(classify("DBMS Assignment.pdf", ["DBMS"], "file")).toBeNull();
    expect(classify("DBMS Prac File Sem 5 (2).docx", ["DBMS"], "file")).toBeNull();
    expect(classify("WhatsApp Image.jpg", ["DBMS"], "file")).toBeNull();
    expect(classify("datesheet.xlsx", [], "file")).toBeNull();
  });
});

describe("classify: textbooks", () => {
  it("skips e-books however they are spelled", () => {
    for (const n of ["korth E book.pdf", "DBMS ebook.pdf", "Navathe e-book.pdf", "Reference Book.pdf", "Text Book Unit 1.pdf"]) {
      expect(classify(n, ["DBMS"], "file")).toBeNull();
    }
  });
});

describe("classify: study material named after an exam", () => {
  it("treats slides and notes for an exam as notes, not papers", () => {
    expect(classify("Mod 1,2 Minor ppt.pdf", ["DBMS"], "file")).toEqual({ kind: "notes" });
    expect(classify("Unit 3 notes for major.pdf", ["DBMS"], "file")).toEqual({ kind: "notes" });
  });
  it("still treats real papers as papers", () => {
    expect(classify("Minor Exam QP DBMS 2025-1.pdf", ["DBMS"], "file")).toEqual({ kind: "pyq", pyqExam: "mid-term" });
    expect(classify("DBMS Major 2021.pdf", ["DBMS"], "file")).toEqual({ kind: "pyq", pyqExam: "end-term" });
    expect(classify("Module 1 notes.pdf", ["CSE201", "PYQs"], "file")?.kind).toBe("pyq"); // a PYQs folder is decisive
  });
});
