import { listFolder } from "@/lib/drive/list";
import { DEFAULT_DRIVE_SOURCES } from "@/lib/drive/sources";

export const runtime = "nodejs";

/** Top-level folders of each Drive source, for linking a subject to a folder by hand. */
export async function GET(req: Request) {
  const ids = new URL(req.url).searchParams.getAll("source").filter((s) => /^[A-Za-z0-9_-]{10,100}$/.test(s));
  const sources = ids.length ? ids.map((id) => ({ id, label: id })) : DEFAULT_DRIVE_SOURCES;
  const out = [];
  for (const s of sources) {
    try {
      const entries = await listFolder(s.id);
      out.push({ source: s.id, label: s.label, folders: entries.filter((e) => e.type === "folder").map(({ id, name }) => ({ id, name })) });
    } catch {
      out.push({ source: s.id, label: s.label, folders: [], error: "unavailable" });
    }
  }
  return Response.json(out);
}
