import { folderName, listFolder } from "@/lib/drive/list";
import { DEFAULT_DRIVE_SOURCES } from "@/lib/drive/sources";

export const runtime = "nodejs";

const ID = /^[A-Za-z0-9_-]{10,100}$/;

/**
 * Top-level folders of each Drive source, for linking a subject to a folder by hand.
 * `?info=<id>` instead checks one folder is public and returns its name (used when adding a source).
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const info = params.get("info");
  if (info) {
    if (!ID.test(info)) return Response.json({ error: "That isn't a Drive folder link." }, { status: 400 });
    try {
      return Response.json({ name: await folderName(info) });
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : "Couldn't open that folder." }, { status: 400 });
    }
  }
  // Settings allows 10 sources; more would only multiply Drive requests.
  const ids = [...new Set(params.getAll("source").filter((s) => ID.test(s)))].slice(0, 10);
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
