import { describe, expect, it } from "vitest";
import { DatesheetSchema } from "../ai/schemas";
import type { Exam, Subject } from "../types";
import { planImport, relevantRows, subjectLabels } from "./plan";

const subjects: Subject[] = [
  { id: 1, name: "Database Management Systems", code: "CSE201", color: "#000", createdAt: 0 },
  { id: 2, name: "Analysis & Design of Algorithms", code: "CSE303", color: "#000", createdAt: 0 },
];
const exam = (over: Partial<Exam>): Exam => ({ id: 9, subjectId: 1, type: "mid-term", date: "2025-09-20", topicIds: [], checklist: [], ...over });

describe("DatesheetSchema", () => {
  it("normalises times and drops impossible dates", () => {
    const r = DatesheetSchema.parse({
      exams: [
        { subject: "0", date: "2025-10-13", time: "2:30 PM", durationMins: "180 mins", type: "end-term", venue: "" },
        { subject: 1, date: "2025-02-30", time: "10:00", type: "mid-term" },
        { subject: 1, date: "13-10-2025", type: "mid-term" },
        { subject: 1, date: "2025-09-22", time: "12:00 am", type: "weird" },
      ],
    });
    expect(r.exams).toHaveLength(2);
    expect(r.exams[0]).toMatchObject({ subject: 0, time: "14:30", durationMins: 180, type: "end-term", venue: null });
    expect(r.exams[1]).toMatchObject({ time: "00:00", type: "other" });
  });
});

describe("subjectLabels", () => {
  it("pairs codes with names", () => {
    expect(subjectLabels([{ name: "DBMS", code: "CSE201" }, { name: "Maths" }])).toEqual(["CSE201 | DBMS", "(no code) | Maths"]);
  });
});

describe("relevantRows", () => {
  it("keeps small sheets whole", () => {
    expect(relevantRows("a | b\nc | d", subjects)).toBe("a | b\nc | d");
  });
  it("keeps headers and the student's rows in big sheets", () => {
    const filler = Array.from({ length: 2000 }, (_, i) => `ECE${100 + (i % 800)} | Some Other Paper ${i} | 2025-10-01`);
    const text = ["## Sheet1", "ODD SEMESTER EXAMINATION 2025", "Code | Paper | Date", ...filler.slice(0, 1000), "CSE 201 | DBMS | 2025-10-13", ...filler.slice(1000), "x | Analysis and Design of Algorithms | 2025-10-15"].join("\n");
    const out = relevantRows(text, subjects);
    expect(out).toContain("ODD SEMESTER EXAMINATION 2025");
    expect(out).toContain("CSE 201 | DBMS");
    expect(out).toContain("Analysis and Design of Algorithms");
    expect(out.length).toBeLessThan(text.length / 10);
  });
});

describe("relevantRows context", () => {
  it("keeps the date row and time-slot row above a matched paper", () => {
    const other = Array.from({ length: 600 }, (_, i) => ` | MAE${100 + i} - Some Paper ${i} | | ECE${100 + i} - Another`);
    const text = [
      "## MID SEM", "AMITY SCHOOL", "SCHEDULE FOR MINOR EXAMINATION", "TENTATIVE", "", "", "", "",
      ...other.slice(0, 300),
      "DAY & DATE | 3, 5, 7 & 9th SEMESTER",
      " | (10:00 to 11:00 AM) | | (02:00 to 03:00 PM)",
      "TUESDAY (09-09-25) | ES208 - Digital Logic | | CSIT124 - Data Structures",
      ...other.slice(300, 320),
      " | ECE205 - Digital Electronics | | CSE336 - Essentials of Cyber Security",
      ...other.slice(320),
    ].join("\n");
    const out = relevantRows(text, [{ name: "Essentials of Cyber Security", code: "CSE336" }]);
    expect(out).toContain("TUESDAY (09-09-25)");
    expect(out).toContain("(02:00 to 03:00 PM)");
    expect(out).toContain("CSE336 - Essentials of Cyber Security");
    expect(out).not.toContain("MAE450");
  });
});

describe("planImport", () => {
  it("flags clashes and duplicates and skips other programmes' papers", () => {
    const rows = planImport(
      [
        { subject: 0, date: "2025-09-24", time: "10:00", durationMins: 60, type: "mid-term", venue: null },
        { subject: 0, date: "2025-09-24", time: "10:00", durationMins: 60, type: "mid-term", venue: null },
        { subject: 1, date: "2025-09-25", time: null, durationMins: null, type: "mid-term", venue: null },
        { subject: -1, date: "2025-09-26", time: null, durationMins: null, type: "mid-term", venue: null },
      ],
      subjects,
      [exam({}), exam({ id: 10, subjectId: 2, date: "2025-09-25" })],
    );
    expect(rows).toHaveLength(3);
    const [dbms, ada, other] = rows;
    expect(dbms).toMatchObject({ subjectId: 1, include: true, action: "update", duplicate: false });
    expect(dbms.clash?.id).toBe(9);
    expect(ada).toMatchObject({ subjectId: 2, include: false, duplicate: true });
    expect(other).toMatchObject({ subjectId: null, include: false });
  });
});
