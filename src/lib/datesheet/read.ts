"use client";

// Turn an uploaded or Drive-fetched date sheet into plain text rows for the AI.
import { extractAny } from "../pdf";

const SHEET = /\.(xlsx|xlsm|xls|ods|csv)$/i;
export const DATESHEET_ACCEPT = ".xlsx,.xls,.ods,.csv,application/pdf,image/*";
const MAX_SHEET_BYTES = 20 * 1024 * 1024; // same cap as the Drive date-sheet route
const MAX_ROWS = 10_000;
const MAX_COLS = 64;

/** Spreadsheet → "## <sheet>" headings and "cell | cell | …" rows. Dates come out as YYYY-MM-DD, not Excel serial numbers. */
async function sheetText(data: ArrayBuffer): Promise<string> {
  const XLSX = await import("xlsx");
  // dateNF belongs here: it replaces Excel's default date format (m/d/yy) as the cells are read. Given to
  // sheet_to_json it's ignored, since the cells already carry their text, so 3 Oct read as "10/3/25".
  // Rows and columns are capped far above any real date sheet: with defval every row is padded out to the
  // sheet's last column, so a cell in column XFD on each row would otherwise fill hundreds of millions of slots.
  const wb = XLSX.read(data, { type: "array", cellDates: true, dense: true, dateNF: "yyyy-mm-dd", sheetRows: MAX_ROWS });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws?.["!ref"]) continue;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    range.e.c = Math.min(range.e.c, range.s.c + MAX_COLS - 1);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "", blankrows: false, range });
    // Keep empty cells so columns line up: many sheets put the time slot in a column header.
    const lines = rows
      .map((r) => {
        const cells = r.map((c) => String(c ?? "").replace(/\s+/g, " ").trim());
        while (cells.length && !cells[cells.length - 1]) cells.pop();
        return cells.some(Boolean) ? cells.join(" | ") : "";
      })
      .filter(Boolean);
    if (lines.length) parts.push(`## ${name}\n${lines.join("\n")}`);
  }
  if (!parts.length) throw new Error("This spreadsheet looks empty.");
  return parts.join("\n\n");
}

/** Read a date sheet file (spreadsheet, PDF or photo) into text. */
export async function readDatesheet(file: File, onStatus?: (s: string) => void): Promise<string> {
  if (SHEET.test(file.name)) {
    if (file.size > MAX_SHEET_BYTES) throw new Error("That spreadsheet is too big to be a date sheet.");
    return sheetText(await file.arrayBuffer());
  }
  return extractAny(file, { onStatus });
}

/** Fetch one of the date sheets found in the Drive folders (through our server) as a File. */
export async function fetchDriveDatesheet(id: string, name: string, sources?: string[]): Promise<File> {
  const qs = new URLSearchParams({ id });
  for (const s of sources ?? []) qs.append("source", s);
  const res = await fetch(`/api/drive/datesheets?${qs}`);
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error ?? `Couldn't get that file from Drive (${res.status})`);
  }
  const blob = await res.blob();
  const type = /\.pdf$/i.test(name) ? "application/pdf" : "application/octet-stream";
  return new File([blob], name, { type });
}
