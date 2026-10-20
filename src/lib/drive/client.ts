"use client";

// Browser side of Drive sync: asks /api/drive/sync for new files and stores them as materials.
import { useSyncExternalStore } from "react";
import { db, getSettings } from "@/lib/db";
import type { Material } from "@/lib/types";
import type { SyncEvent } from "./sync";
import { DEFAULT_DRIVE_SOURCES } from "./sources";

export interface DriveSyncState {
  running: boolean;
  message: string; // short human status line
  imported: number;
  deferred: number; // left for a later sync (scan budget, AI busy, no Gemini key)
  errors: string[];
  remaining: number; // files found but not fetched this time
}

const IDLE: DriveSyncState = { running: false, message: "", imported: 0, deferred: 0, errors: [], remaining: 0 };
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
const OCR_PER_OPEN = 10; // scanned papers read by Gemini per app open

/** Run a sync. `auto` (on app open) is skipped when disabled, offline, or synced recently. */
export async function runDriveSync({ auto = false } = {}) {
  if (state.running) return;
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

  set({ ...IDLE, running: true, message: "Looking through your Drive folders…" });
  const names = new Map(subjects.map((s) => [s.id!, s.name]));
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const known = (await db.driveFiles.toCollection().primaryKeys()) as string[];
      const res = await fetch("/api/drive/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjects: subjects.map((s) => ({ id: s.id!, name: s.name, code: s.code })),
          known,
          sources: settings.driveSources?.length ? settings.driveSources : DEFAULT_DRIVE_SOURCES,
          links: subjects.filter((s) => s.driveFolderIds?.length).map((s) => ({ subjectId: s.id!, folderIds: s.driveFolderIds! })),
          maxOcr: round === 0 ? OCR_PER_OPEN : 0,
        }),
      });
      if (!res.ok || !res.body) throw new Error(`Drive sync failed (${res.status})`);

      let importedThisRound = 0;
      for await (const ev of readEvents(res.body)) {
        importedThisRound += await handle(ev, names);
      }
      if (!state.remaining || !importedThisRound) break;
    }
    await db.settings.put({ ...(await getSettings()), lastDriveSync: Date.now() });
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
    if (value) buf += dec.decode(value, { stream: !done });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield JSON.parse(line) as SyncEvent;
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
      if (!names.has(ev.subjectId)) return 0; // subject deleted mid-sync
      const material: Material = {
        subjectId: ev.subjectId,
        kind: f.kind === "pyq" ? "pyq" : "notes",
        fileName: f.name,
        text: f.text,
        createdAt: Date.now(),
        pyqExam: f.pyqExam,
        source: { driveId: f.driveId, url: f.url, path: f.path, format: f.kind, ocr: f.ocr },
      };
      await db.transaction("rw", db.materials, db.driveFiles, async () => {
        if (await db.driveFiles.get(f.driveId)) return;
        await db.materials.add(material);
        await db.driveFiles.put({ driveId: f.driveId, subjectId: ev.subjectId, name: f.name, status: "imported", at: Date.now() });
      });
      set({ imported: state.imported + 1, message: `${names.get(ev.subjectId)}: ${f.name}` });
      return 1;
    }
    case "skip":
      await db.driveFiles.put({ driveId: ev.driveId, subjectId: ev.subjectId, name: ev.name, status: "skipped", reason: ev.reason, at: Date.now() });
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
