import { describe, expect, it } from "vitest";
import { findCode, parseCourse } from "./catalog";

const catalog = [
  "CSE201 - Database Management Systems",
  "CSE202 - Operating System",
  "CSE303 - Analysis & Design of Algorithms",
  "CSE336 - Essentials of Cyber Security",
  "CSIT124 - Data Structures Using C",
  "BS207 - Self-Reliance and Socialization",
].map((n) => parseCourse(n)!);

describe("parseCourse", () => {
  it("reads code and name from library folder names", () => {
    expect(parseCourse("CSE201 - Database Management Systems")).toEqual({ code: "CSE201", name: "Database Management Systems" });
    expect(parseCourse("CSIT124 - Data Structures Using C")?.code).toBe("CSIT124");
    expect(parseCourse("DBMS")).toBeNull();
    expect(parseCourse("PYQs")).toBeNull();
    expect(parseCourse("  CSE202: Operating System  ")).toEqual({ code: "CSE202", name: "Operating System" });
    expect(parseCourse("CSE202 -   ")).toBeNull();
  });

  it("stays fast on crafted folder names", () => {
    const t = performance.now();
    parseCourse(`CSE201 - a${" ".repeat(290)}`);
    parseCourse(`CSE201 -${" ".repeat(100_000)}x\n`);
    parseCourse(`${" ".repeat(100_000)}CSE201`);
    expect(performance.now() - t).toBeLessThan(100);
  });
});

describe("findCode", () => {
  it("matches exact names, ignoring case and & vs and", () => {
    expect(findCode("database management systems", catalog)).toBe("CSE201");
    expect(findCode("Analysis and Design of Algorithms", catalog)).toBe("CSE303");
  });
  it("matches common short forms", () => {
    expect(findCode("DBMS", catalog)).toBe("CSE201");
  });
  it("stays empty when unsure", () => {
    expect(findCode("Data", catalog)).toBeUndefined();
    expect(findCode("Organic Chemistry", catalog)).toBeUndefined();
    expect(findCode("", catalog)).toBeUndefined();
  });
});
