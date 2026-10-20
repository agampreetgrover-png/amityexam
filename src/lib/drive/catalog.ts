// Course catalogue from the Drive library's folder names, e.g. "CSE201 - Database Management Systems".
import { subjectScore } from "./classify";

export interface Course {
  code: string;
  name: string;
}

const FOLDER = /^\s*([A-Z]{2,5})\s?(\d{3}[A-Z]?)\s*[-–:]\s*(.+?)\s*$/;

/** Parse "CSE201 - Database Management Systems" into a course; null for other folder names. */
export function parseCourse(folderName: string): Course | null {
  const m = folderName.match(FOLDER);
  return m ? { code: `${m[1]}${m[2]}`, name: m[3] } : null;
}

const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The course code for a subject name, or undefined when there's no confident match:
 * an exact name match first, else one clearly-best fuzzy match (acronyms like "DBMS" count).
 */
export function findCode(name: string, catalog: Course[]): string | undefined {
  const n = norm(name);
  if (n.length < 3) return undefined;
  const exact = catalog.filter((c) => norm(c.name) === n);
  if (exact.length) return exact[0].code;
  const scored = catalog
    .map((c) => ({ c, s: subjectScore(name, { id: 0, name: c.name }) }))
    .filter((x) => x.s >= 0.8)
    .sort((a, b) => b.s - a.s);
  if (!scored.length || (scored[1] && scored[1].s === scored[0].s)) return undefined; // ambiguous
  return scored[0].c.code;
}
