import { parseCourse, type Course } from "@/lib/drive/catalog";
import { listFolder } from "@/lib/drive/list";
import { DEFAULT_DRIVE_SOURCES } from "@/lib/drive/sources";

export const runtime = "nodejs";

// The library changes rarely; keep it for an hour so opening the form stays instant.
let cache: { at: number; courses: Course[] } | null = null;
const TTL = 60 * 60_000;

/** Course codes and names parsed from the Drive library's "CODE - Name" folders. */
export async function GET() {
  if (cache && Date.now() - cache.at < TTL) return Response.json(cache.courses);
  const courses = new Map<string, Course>();
  for (const s of DEFAULT_DRIVE_SOURCES) {
    try {
      for (const e of await listFolder(s.id)) {
        const c = e.type === "folder" ? parseCourse(e.name) : null;
        if (c && !courses.has(c.code)) courses.set(c.code, c);
      }
    } catch {
      // a source being unavailable just means fewer suggestions
    }
  }
  const list = [...courses.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (list.length) cache = { at: Date.now(), courses: list };
  return Response.json(list);
}
