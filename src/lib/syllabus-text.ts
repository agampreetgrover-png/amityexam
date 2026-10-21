import type { SyllabusResult } from "./ai/schemas";

// "1.", "1)", "(a)", "a.", "ii.", "-", "*", "•" and similar markers pasted from a PDF or a list.
const MARKER = /^\s*(?:[-*•▪◦–]|\(?[0-9]{1,3}[.)]|\(?[a-z][.)]|[ivx]{1,4}[.)])\s*/i;

/** Splits pasted syllabus text into topic titles: one per line, list markers, blanks and repeats dropped. */
export function parseTopics(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const title = raw.replace(MARKER, "").trim();
    const key = title.toLowerCase();
    if (title && !seen.has(key)) {
      seen.add(key);
      out.push(title);
    }
  }
  return out;
}

const HEADING = /^(?:unit|module|chapter|part|section)\s*[-–:.]?\s*(?:\d{1,2}|[ivx]{1,5})\b/i;
// Reading lists and outcomes that follow the units in a syllabus PDF; not topics to study.
const OTHER_SECTION = /^(?:text\s?books?|references?|suggested readings?|course (?:objectives?|outcomes?)|learning outcomes?|examination scheme|evaluation scheme|pedagogy|pre-?requisites?)\b/i;
// "(20%)", "20%", "[8 hours]", "Weightage: 25%" at the end of a line.
const LOAD = /\s*[([]?\s*(?:weightage\s*:?\s*)?\d{1,3}\s*(?:%|hours?|hrs?|lectures?)\s*[)\]]?\s*$/i;
const TABLE_HEADER = /^(?:s\.?\s?no\.?|sr\.?\s?no\.?|modules?|units?|contents?|topics?|weightage|hours|syllabus|details?)$/i;

/** Splits "Paging, segmentation (with TLB); thrashing" on commas and semicolons outside brackets. */
function splitList(line: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of line) {
    if (ch === "(" || ch === "[") depth++;
    else if ((ch === ")" || ch === "]") && depth) depth--;
    if ((ch === "," || ch === ";") && !depth) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.replace(MARKER, "").replace(/^(?:and|&)\s+/i, "").replace(/[.:]+$/, "").trim()).filter(Boolean);
}

/**
 * Turns a pasted syllabus into units and topics without AI: "Unit/Module …" lines start a unit,
 * other lines are split on commas into topics. Rough, so the result goes through the same review as an AI import.
 */
export function parseSyllabus(text: string): SyllabusResult["units"] {
  const units: SyllabusResult["units"] = [];
  let skip = false;
  const add = (title: string) => {
    if (skip) return;
    if (!units.length) units.push({ title: "Unit 1", topics: [] });
    const u = units[units.length - 1];
    if (!u.topics.some((t) => t.title.toLowerCase() === title.toLowerCase())) u.topics.push({ title, difficulty: 3 });
  };
  for (const raw of text.split(/\r?\n/)) {
    if (/^[\s|:-]+$/.test(raw)) continue; // blank, or a Markdown table rule "|---|---|"
    // Photos and scans come back as Markdown tables: each cell is read like a line of its own.
    const cells = raw.replace(/\*\*|^#+\s*/g, "").split("|").map((c) => c.replace(MARKER, "").replace(LOAD, "").trim()).filter(Boolean);
    if (cells.length > 1 && cells.every((c) => TABLE_HEADER.test(c))) continue;
    for (const line of cells) {
      if (HEADING.test(line)) {
        skip = false;
        const [title, ...rest] = splitList(line);
        units.push({ title, topics: [] });
        rest.forEach(add);
      } else if (OTHER_SECTION.test(line)) skip = true;
      else splitList(line).forEach(add);
    }
  }
  return units.filter((u) => u.topics.length);
}
