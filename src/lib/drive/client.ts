"use client";

// Browser side of Drive sync: asks /api/drive/sync for new files and stores them as materials.
import { useSyncExternalStore } from "react";
import { db, getSettings } from "@/lib/db";
import type { Material } from "@/lib/types";
import type { SyncEvent } from "./sync";
import { DEFAULT_DRIVE_SOURCES, MAX_DRIVE_SOURCES, MAX_SOURCE_LABEL } from "./sources";

interface DriveSyncState {
  running: boolean;
  message: string; // short human status line
  imported: number;
  deferred: number; // left for a later sync (scan budget, AI busy, no AI key that reads files)
  errors: string[];
  notices: string[]; // things the student can fix, e.g. a subject that fits two folders
  remaining: number; // files found but not fetched this time
}

const IDLE: DriveSyncState = { running: false, message: "", imported: 0, deferred: 0, errors: [], notices: [], remaining: 0 };
let state = IDLE;
const listeners = new Set<() => void>();
const set = (patch: Partial<DriveSyncState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export function useDriveSync(): DriveSyncState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
    () => IDLE,
  );
}

const AUTO_INTERVAL = 30 * 60_000; // don't re-sync on every reload
const MAX_ROUNDS = 4; // each round fetches up to 60 files
const OCR_PER_OPEN = 10; // scanned papers read by AI per app open

let inFlight = false; // set synchronously, so two calls in the same tick can't both start a sync
let rerun = false; // a manual sync was asked for while one was running (e.g. a subject was just added)

/** Run a sync. `auto` (on app open) is skipped when disabled, offline, or synced recently. */
export async function runDriveSync({ auto = false } = {}) {
  if (inFlight) {
    if (!auto) rerun = true;
    return;
  }
  inFlight = true;
  try {
    await sync(auto);
  } finally {
    inFlight = false;
    if (rerun) {
      rerun = false;
      void runDriveSync();
    }
  }
}

async function sync(auto: boolean) {
  const settings = await getSettings();
  if (auto && (settings.driveSync === false || (settings.lastDriveSync ?? 0) > Date.now() - AUTO_INTERVAL)) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    if (!auto) set({ message: "You're offline. Drive sync needs internet." });
    return;
  }
  const subjects = await db.subjects.toArray();
  if (!subjects.length) {
    if (!auto) set({ message: "Add a subject first. Sync only fetches files for your subjects." });
    return;
  }

  // An empty list is the student's choice (they removed every folder); only unset means the defaults.
  // Capped at what the sync route takes, labels included, so one folder too many can't fail every sync.
  const sources = (settings.driveSources ?? DEFAULT_DRIVE_SOURCES)
    .slice(0, MAX_DRIVE_SOURCES)
    .map((s) => ({ ...s, label: s.label.slice(0, MAX_SOURCE_LABEL) }));
  // Folders linked to a subject by hand are synced even with no source folders.
  if (!sources.length && !subjects.some((s) => s.driveFolderIds?.length)) {
    if (!auto) set({ message: "No Drive folders to sync. Add one in Settings → Google Drive." });
    return;
  }

  set({ ...IDLE, running: true, message: "Looking through your Drive folders…" });
  const names = new Map(subjects.map((s) => [s.id!, s.name]));
  // Files deferred or failed in this sync aren't asked for again in its later rounds, so a batch full of
  // queued scans can't crowd out the notes and slides behind it.
  const tried = new Set<string>();
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const known = [...((await db.driveFiles.toCollection().primaryKeys()) as string[]), ...tried];
      const res = await fetch("/api/drive/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjects: subjects.map((s) => ({ id: s.id!, name: s.name, code: s.code })),
          known,
          sources,
          links: subjects.filter((s) => s.driveFolderIds?.length).map((s) => ({ subjectId: s.id!, folderIds: s.driveFolderIds! })),
          maxOcr: round === 0 ? OCR_PER_OPEN : 0,
        }),
      });
      if (!res.ok || !res.body) throw new Error(`Drive sync failed (${res.status})`);

      let handledThisRound = 0;
      for await (const ev of readEvents(res.body)) {
        if ((ev.type === "deferred" || ev.type === "error") && ev.driveId) tried.add(ev.driveId);
        if (ev.type === "file" || ev.type === "skip" || ev.type === "deferred" || (ev.type === "error" && ev.driveId)) handledThisRound++;
        await handle(ev, names);
      }
      // Keep going while files remain and this round got through some of them.
      if (!state.remaining || !handledThisRound) break;
    }
    // In one transaction, so a setting changed while the sync ran isn't overwritten with the old value.
    await db.transaction("rw", db.settings, async () => db.settings.put({ ...(await getSettings()), lastDriveSync: Date.now() }));
    // Split new past papers into questions and sort them by year and topic (runs in the background).
    // Imported here so the analyser isn't in every page's bundle just because sync is mounted in the layout.
    void import("@/lib/pyq/analyse").then((m) => m.analyseAll());
    const { imported, deferred, errors } = state;
    set({
      message: imported
        ? `Added ${imported} file${imported === 1 ? "" : "s"} from Drive.${deferred ? ` ${deferred} scanned paper${deferred === 1 ? "" : "s"} queued for later.` : ""}`
        : deferred ? `Up to date. ${deferred} scanned paper${deferred === 1 ? "" : "s"} queued for later.` : errors.length ? "Sync finished with some errors." : "Everything is up to date.",
    });
  } catch (e) {
    set({ message: e instanceof Error ? e.message : "Drive sync failed" });
  } finally {
    set({ running: false });
  }
}

async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SyncEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    buf += done ? dec.decode() + "\n" : dec.decode(value, { stream: true }); // at the end, flush a split character and the last line
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        yield JSON.parse(line) as SyncEvent;
      } catch {
        // a garbled line (e.g. the connection dropped mid-write) shouldn't end the whole sync
      }
    }
    if (done) return;
  }
}

/** Apply one server event; returns 1 when a file was imported. */
async function handle(ev: SyncEvent, names: Map<number, string>): Promise<number> {
  switch (ev.type) {
    case "plan":
      set({ remaining: ev.remaining, message: ev.total ? `Fetching ${ev.total} new file${ev.total === 1 ? "" : "s"}…` : state.message });
      return 0;
    case "file": {
      const f = ev.file;
      if (!names.has(ev.subjectId)) return 0;
      const material: Material = {
        subjectId: ev.subjectId,
        kind: f.kind === "pyq" ? "pyq" : "notes",
        fileName: f.name,
        text: f.text,
        createdAt: Date.now(),
        pyqExam: f.pyqExam,
        source: { driveId: f.driveId, url: f.url, path: f.path, format: f.kind, ocr: f.ocr },
      };
      const added = await db.transaction("rw", db.subjects, db.materials, db.driveFiles, async () => {
        // The subject may have been deleted while the sync ran; its files mustn't be added (or remembered).
        if (!(await db.subjects.get(ev.subjectId)) || (await db.driveFiles.get(f.driveId))) return false;
        await db.materials.add(material);
        await db.driveFiles.put({ driveId: f.driveId, subjectId: ev.subjectId, name: f.name, status: "imported", at: Date.now() });
        return true;
      });
      if (!added) return 0;
      set({ imported: state.imported + 1, message: `${names.get(ev.subjectId)}: ${f.name}` });
      return 1;
    }
    case "skip":
      await db.transaction("rw", db.subjects, db.driveFiles, async () => {
        if (await db.subjects.get(ev.subjectId)) {
          await db.driveFiles.put({ driveId: ev.driveId, subjectId: ev.subjectId, name: ev.name, status: "skipped", reason: ev.reason, at: Date.now() });
        }
      });
      return 0;
    case "notice":
      set({ notices: [...new Set([...state.notices, ev.message])].slice(-10) });
      return 0;
    case "deferred":
      set({ deferred: state.deferred + 1 });
      return 0;
    case "error":
      set({ errors: [...state.errors, ev.name ? `${ev.name}: ${ev.message}` : ev.message].slice(-20) });
      return 0;
    default:
      return 0;
  }
}
