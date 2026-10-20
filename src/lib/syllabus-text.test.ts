import { describe, expect, it } from "vitest";
import { parseTopics } from "./syllabus-text";

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
