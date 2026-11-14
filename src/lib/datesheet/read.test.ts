import { describe, expect, it } from "vitest";
import { readDatesheet } from "./read";

describe("readDatesheet", () => {
  it("keeps CSV dates day-first and keeps start times", async () => {
    const csv = "Code,Date,Time\nCSE201,03/10/2025,10:00 AM\nCSE303,25/10/2025,14:30\n";
    const text = await readDatesheet(new File([csv], "datesheet.csv", { type: "text/csv" }));
    expect(text).toContain("CSE201 | 03/10/2025 | 10:00 AM");
    expect(text).toContain("CSE303 | 25/10/2025 | 14:30");
    expect(text).not.toContain("1900-01-00");
  });

  it("still writes real spreadsheet date cells as YYYY-MM-DD", async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([["Code", "Date"], ["CSE201", new Date(Date.UTC(2025, 9, 3))]], { cellDates: true });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf: ArrayBuffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const text = await readDatesheet(new File([buf], "datesheet.xlsx"));
    expect(text).toContain("CSE201 | 2025-10-03");
  });
});
