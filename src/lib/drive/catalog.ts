// Course catalogue from the Drive library's folder names, e.g. "CSE201 - Database Management Systems".
import { norm, subjectScore } from "./classify";

export interface Course {
  code: string;
  name: string;
}

// Only the code and the separator are matched by pattern; the name is whatever follows, trimmed. Folder names
// come from Drive, so the pattern has no two quantifiers that can trade characters (the old `(.+?)\s*$` took
// seconds on a crafted name full of spaces).
const PREFIX = /^([A-Z]{2,5}) ?(\d{3}[A-Z]?)\s*[-–:]/;
const MAX_NAME = 300; // real course folders are far shorter

/** Parse "CSE201 - Database Management Systems" into a course; null for other folder names. */
export function parseCourse(folderName: string): Course | null {
  if (folderName.length > MAX_NAME) return null;
  const s = folderName.trim();
  const m = PREFIX.exec(s);
  const name = m ? s.slice(m[0].length).trim() : "";
  return m && name ? { code: `${m[1]}${m[2]}`, name } : null;
}

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
