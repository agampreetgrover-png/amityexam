// Lists public Drive folders without an API key, via Drive's embeddable folder view.
// Server-only: the page is fetched from Next's server, which avoids CORS.

export type EntryType = "folder" | "file" | "gdoc" | "gslides" | "gsheet";

export interface DriveEntry {
  id: string;
  name: string;
  type: EntryType;
  url: string;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
const decode = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|#39);/g, (e) => ENTITIES[e]).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

function parse(url: string): { id: string; type: EntryType } | null {
  let m = url.match(/\/drive\/folders\/([A-Za-z0-9_-]+)/);
  if (m) return { id: m[1], type: "folder" };
  m = url.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
  if (m) return { id: m[1], type: "file" };
  m = url.match(/docs\.google\.com\/(document|presentation|spreadsheets)\/d\/([A-Za-z0-9_-]+)/);
  if (m) return { id: m[2], type: m[1] === "document" ? "gdoc" : m[1] === "presentation" ? "gslides" : "gsheet" };
  return null;
}

export async function listFolder(folderId: string, signal?: AbortSignal): Promise<DriveEntry[]> {
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}`, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`Drive folder unavailable (${res.status}). Is it still shared publicly?`);
  const html = await res.text();
  const out: DriveEntry[] = [];
  const re = /<a href="([^"]+)"[^>]*>[\s\S]{0,800}?<div class="flip-entry-title">([^<]+)</g;
  for (const m of html.matchAll(re)) {
    const href = decode(m[1]);
    const p = parse(href);
    if (p) out.push({ ...p, name: decode(m[2]).trim(), url: href });
  }
  return out;
}

export interface CrawledFile extends DriveEntry {
  path: string[]; // folder names from the source root, e.g. ["CSE201 - Database Management Systems", "PYQs"]
}

/** Recursively collects files under a folder. Folders for which `skipFolder` returns true are not entered. */
export async function crawl(
  folderId: string,
  opts: { path?: string[]; maxDepth?: number; skipFolder?: (name: string) => boolean; signal?: AbortSignal } = {},
): Promise<CrawledFile[]> {
  const { path = [], maxDepth = 4, skipFolder, signal } = opts;
  const entries = await listFolder(folderId, signal);
  const files: CrawledFile[] = [];
  for (const e of entries) {
    if (e.type !== "folder") files.push({ ...e, path });
    else if (path.length < maxDepth && !skipFolder?.(e.name)) {
      files.push(...(await crawl(e.id, { path: [...path, e.name], maxDepth, skipFolder, signal })));
    }
  }
  return files;
}
