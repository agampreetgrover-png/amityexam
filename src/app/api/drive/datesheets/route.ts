import { listFolder, type CrawledFile } from "@/lib/drive/list";
import { DEFAULT_DRIVE_SOURCES } from "@/lib/drive/sources";

export const runtime = "nodejs";
export const maxDuration = 60;

const NAME = /date ?sheet|schedule|time ?table|examination|mid[- ]?sem|end[- ]?sem/i;
// Past papers also mention "exam"/"sem"; never offer those as date sheets.
const NOT_A_SHEET = /\b(qp|question|papers?|pyqs?|major|minor|solutions?|notes?)\b/i;
const EXT = /\.(xlsx|xls|csv|pdf)$/i;
const ID = /^[A-Za-z0-9_-]{10,100}$/;
const MAX_BYTES = 20 * 1024 * 1024;

type Candidate = CrawledFile & { source: string };
const isSheet = (name: string) => NAME.test(name) && EXT.test(name) && !NOT_A_SHEET.test(name);

// Listing means one request per folder (the library has ~80), so cache the result briefly;
// the ?id= download re-checks against this same list.
const cache = new Map<string, { at: number; list: Candidate[] }>();
const TTL = 10 * 60_000;

/** Date-sheet-looking files in the top level and one folder deep of the Drive sources. */
async function candidates(sourceIds: string[]): Promise<Candidate[]> {
  const key = sourceIds.join(",");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.list;
  const out: Candidate[] = [];
  for (const source of sourceIds) {
    let top;
    try {
      top = await listFolder(source);
    } catch {
      continue; // an unavailable source just contributes nothing
    }
    for (const e of top) if (e.type === "file" && isSheet(e.name)) out.push({ ...e, path: [], source });
    // Subfolders are read 8 at a time; one unreadable folder is skipped.
    const folders = top.filter((e) => e.type === "folder");
    for (let i = 0; i < folders.length; i += 8) {
      const batch = await Promise.all(folders.slice(i, i + 8).map((f) => listFolder(f.id).then((xs) => ({ f, xs }), () => ({ f, xs: [] }))));
      for (const { f, xs } of batch) for (const e of xs) if (e.type === "file" && isSheet(e.name)) out.push({ ...e, path: [f.name], source });
    }
  }
  cache.set(key, { at: Date.now(), list: out });
  return out;
}

/**
 * GET            → [{ id, name, path }] candidate date sheets
 * GET ?id=<file> → that file's bytes, only if it's one of the candidates (never an open proxy)
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sources = url.searchParams.getAll("source").filter((s) => ID.test(s));
  const ids = sources.length ? sources : DEFAULT_DRIVE_SOURCES.map((s) => s.id);
  const id = url.searchParams.get("id");
  if (id && !ID.test(id)) return Response.json({ error: "Bad file id" }, { status: 400 });
  const list = await candidates(ids);
  if (!id) return Response.json(list.map(({ id, name, path }) => ({ id, name, path })));

  const file = list.find((f) => f.id === id);
  if (!file) return Response.json({ error: "Not a date sheet in your Drive folders" }, { status: 404 });

  // Same download URL and retry policy as the notes sync (src/lib/drive/extract.ts).
  const get = () => fetch(`https://drive.usercontent.google.com/download?id=${file.id}&export=download&confirm=t`, { cache: "no-store" });
  let res = await get();
  for (let attempt = 1; attempt < 3 && (res.status === 429 || res.status >= 500); attempt++) {
    await new Promise((r) => setTimeout(r, 1500 * attempt));
    res = await get();
  }
  if (!res.ok || res.headers.get("content-type")?.includes("text/html")) {
    return Response.json({ error: "Couldn't download that file from Drive. Try again in a minute." }, { status: 502 });
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return Response.json({ error: "That file is too large" }, { status: 413 });
  return new Response(buf, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(file.name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
