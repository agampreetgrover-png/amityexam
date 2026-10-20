// Server-only: find each subject's material in the Drive sources and yield it as events.
import { classify, MATCH_THRESHOLD, skipFolder, subjectScore, type DriveKind, type PyqExam, type SubjectRef } from "./classify";
import { DeferFile, fileText, SkipFile } from "./extract";
import { crawl, listFolder, type CrawledFile } from "./list";
import type { DriveSource } from "./sources";

export interface SyncRequest {
  subjects: SubjectRef[];
  known: string[]; // Drive file ids already imported or permanently skipped
  sources: DriveSource[];
  links?: { subjectId: number; folderIds: string[] }[]; // folders the user picked by hand
  maxFiles?: number;
  maxOcr?: number; // scanned files read with Gemini per run (each costs one AI request)
}

export interface SyncedFile {
  driveId: string;
  name: string;
  path: string[];
  url: string;
  kind: DriveKind;
  pyqExam?: PyqExam;
  text: string;
  ocr: boolean;
}

export type SyncEvent =
  | { type: "match"; subjectId: number; folders: { id: string; name: string; source: string }[] }
  | { type: "plan"; total: number; remaining: number }
  | { type: "file"; subjectId: number; file: SyncedFile }
  | { type: "skip"; subjectId: number; driveId: string; name: string; reason: string }
  | { type: "deferred"; subjectId: number; driveId: string; name: string; reason: string }
  | { type: "error"; subjectId?: number; driveId?: string; name?: string; message: string }
  | { type: "done"; imported: number; skipped: number; deferred: number; failed: number };

const PYQ_FOLDER = /\b(pyqs?|papers?|question ?papers?|previous)\b/i;
const yearOf = (n: string) => Number(n.match(/(20dd)/)?.[1] ?? 0);
const sameName = (n: string) => n.toLowerCase().replace(/\s*\(\d+\)(?=\.[a-z0-9]+$)/, "").replace(/\s+/g, " ").trim();

function bestSubject(name: string, subjects: SubjectRef[]): SubjectRef | undefined {
  let best: SubjectRef | undefined;
  let score = 0;
  for (const s of subjects) {
    const sc = subjectScore(name, s);
    if (sc > score) [best, score] = [s, sc];
  }
  return score >= MATCH_THRESHOLD ? best : undefined;
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

export async function* syncDrive(req: SyncRequest, signal?: AbortSignal): AsyncGenerator<SyncEvent> {
  const { subjects, sources } = req;
  const known = new Set(req.known);
  const maxFiles = req.maxFiles ?? 60;
  // subjectId → candidate files
  const found = new Map<number, CrawledFile[]>();
  const add = (sid: number, files: CrawledFile[]) => found.set(sid, [...(found.get(sid) ?? []), ...files]);

  for (const src of sources) {
    let top;
    try {
      top = await listFolder(src.id, signal);
    } catch (e) {
      yield { type: "error", message: `${src.label}: ${e instanceof Error ? e.message : "unavailable"}` };
      continue;
    }
    const matched = new Map<number, { id: string; name: string; source: string }[]>();
    for (const entry of top) {
      const subject = bestSubject(entry.name, subjects);
      try {
        if (entry.type === "folder" && subject) {
          // A subject's own folder: everything inside belongs to it.
          matched.set(subject.id, [...(matched.get(subject.id) ?? []), { id: entry.id, name: entry.name, source: src.label }]);
          add(subject.id, await crawl(entry.id, { path: [entry.name], skipFolder, signal }));
        } else if (entry.type === "folder" && PYQ_FOLDER.test(entry.name)) {
          // A mixed past-papers folder: assign each file by its own name.
          for (const f of await crawl(entry.id, { path: [entry.name], skipFolder, signal })) {
            const s = bestSubject(f.name, subjects);
            if (s) add(s.id, [f]);
          }
        } else if (entry.type !== "folder" && subject) {
          add(subject.id, [{ ...entry, path: [] }]);
        }
      } catch (e) {
        yield { type: "error", subjectId: subject?.id, message: `${entry.name}: ${e instanceof Error ? e.message : "unavailable"}` };
      }
    }
    for (const [subjectId, folders] of matched) yield { type: "match", subjectId, folders };
  }

  for (const link of req.links ?? []) {
    for (const folderId of link.folderIds) {
      try {
        add(link.subjectId, await crawl(folderId, { skipFolder, signal }));
      } catch (e) {
        yield { type: "error", subjectId: link.subjectId, message: `Linked folder: ${e instanceof Error ? e.message : "unavailable"}` };
      }
    }
  }

  // Classify, drop known files, and de-duplicate copies that appear in both drives.
  const queue: { subjectId: number; f: CrawledFile; kind: DriveKind; pyqExam?: PyqExam }[] = [];
  const seen = new Set<string>();
  for (const [subjectId, files] of found) {
    for (const f of files) {
      const key = `${subjectId}:${sameName(f.name)}`;
      if (known.has(f.id) || seen.has(f.id) || seen.has(key)) continue;
      seen.add(f.id);
      seen.add(key);
      const c = classify(f.name, f.path, f.type);
      if (c) queue.push({ subjectId, f, ...c });
    }
  }
  // PYQs first, newest year first: the most exam-relevant if a run gets cut short.
  queue.sort((a, b) => Number(b.kind === "pyq") - Number(a.kind === "pyq") || yearOf(b.f.name) - yearOf(a.f.name));
  const batch = queue.slice(0, maxFiles);
  yield { type: "plan", total: batch.length, remaining: queue.length - batch.length };

  // Run downloads concurrently but yield events in order through a small buffer.
  const events: SyncEvent[] = [];
  let wake: (() => void) | null = null;
  const push = (e: SyncEvent) => {
    events.push(e);
    wake?.();
  };
  let imported = 0, skipped = 0, deferred = 0, failed = 0, finished = false;
  let ocrLeft = req.maxOcr ?? 10;
  const takeOcrSlot = () => ocrLeft-- > 0;
  const work = pool(batch, 3, async ({ subjectId, f, kind, pyqExam }) => {
    if (signal?.aborted) return;
    try {
      const { text, ocr } = await fileText(f, { signal, takeOcrSlot });
      if (!text) throw new SkipFile("no readable text");
      imported++;
      push({ type: "file", subjectId, file: { driveId: f.id, name: f.name, path: f.path, url: f.url, kind, pyqExam, text, ocr } });
    } catch (e) {
      if (e instanceof DeferFile) {
        deferred++;
        push({ type: "deferred", subjectId, driveId: f.id, name: f.name, reason: e.message });
      } else if (e instanceof SkipFile) {
        skipped++;
        push({ type: "skip", subjectId, driveId: f.id, name: f.name, reason: e.message });
      } else {
        failed++;
        push({ type: "error", subjectId, driveId: f.id, name: f.name, message: e instanceof Error ? e.message.slice(0, 200) : "failed" });
      }
    }
  }).finally(() => {
    finished = true;
    wake?.();
  });

  while (!finished || events.length) {
    if (!events.length) await new Promise<void>((r) => (wake = r));
    wake = null;
    while (events.length) yield events.shift()!;
  }
  await work;
  yield { type: "done", imported, skipped, deferred, failed };
}
