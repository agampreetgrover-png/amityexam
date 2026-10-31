import Dexie, { type EntityTable } from "dexie";
import {
  DEFAULT_SETTINGS,
  type Chat, type ChatMessage, type DriveFile, type Exam, type PyqQuestion, type GeneratedDoc, type Material,
  type QuizAttempt, type Settings, type Subject, type Topic, type Unit,
} from "./types";
import { MAX_DRIVE_SOURCES } from "./drive/sources";

class ExamDB extends Dexie {
  subjects!: EntityTable<Subject, "id">;
  units!: EntityTable<Unit, "id">;
  topics!: EntityTable<Topic, "id">;
  exams!: EntityTable<Exam, "id">;
  materials!: EntityTable<Material, "id">;
  driveFiles!: EntityTable<DriveFile, "driveId">;
  pyqQuestions!: EntityTable<PyqQuestion, "id">;
  quizzes!: EntityTable<QuizAttempt, "id">;
  docs!: EntityTable<GeneratedDoc, "id">;
  messages!: EntityTable<ChatMessage, "id">;
  chats!: EntityTable<Chat, "id">;
  settings!: EntityTable<Settings, "id">;

  constructor() {
    super("amityexams");
    this.version(1).stores({
      subjects: "++id, name",
      units: "++id, subjectId, order",
      topics: "++id, subjectId, unitId, status, nextReview",
      exams: "++id, subjectId, date",
      sessions: "++id, date, topicId, examId, done",
      materials: "++id, subjectId, kind",
      flashcards: "++id, subjectId, topicId, due",
      quizzes: "++id, subjectId, createdAt",
      docs: "++id, subjectId, topicId, kind",
      messages: "++id, subjectId, createdAt",
      settings: "id",
    });
    this.version(2).stores({ flashcards: null }); // drops the removed flashcards table
    this.version(3).stores({ driveFiles: "driveId, subjectId, status" }); // Google Drive sync bookkeeping
    this.version(4).stores({ pyqQuestions: "++id, subjectId, materialId, topicId, year" }); // past-paper question bank
    this.version(5).stores({ sessions: null, topics: "++id, subjectId, unitId, status" }); // the planner and spaced revision were removed
    // Study chat: saved conversations, and their messages found by chatId. Existing messages are untouched.
    this.version(6).stores({ chats: "++id, subjectId, updatedAt", messages: "++id, subjectId, createdAt, chatId" });
  }
}

export const db = new ExamDB();

export async function getSettings(): Promise<Settings> {
  return (await db.settings.get("settings")) ?? DEFAULT_SETTINGS;
}

/** Delete a subject and everything hanging off it. */
export async function deleteSubject(subjectId: number) {
  await db.transaction("rw", [db.subjects, db.units, db.topics, db.exams, db.materials, db.quizzes, db.docs, db.messages, db.chats, db.driveFiles, db.pyqQuestions], async () => {
    for (const table of [db.units, db.topics, db.exams, db.materials, db.quizzes, db.docs, db.messages, db.chats, db.driveFiles, db.pyqQuestions]) {
      await (table as Dexie.Table<{ subjectId: number }>).where({ subjectId }).delete();
    }
    await db.subjects.delete(subjectId);
  });
}

/** Delete a material and the past-paper questions taken from it. */
export async function deleteMaterial(materialId: number) {
  await db.transaction("rw", db.materials, db.pyqQuestions, async () => {
    await db.pyqQuestions.where({ materialId }).delete();
    await db.materials.delete(materialId);
  });
}

/** Delete a study-chat conversation and its messages. */
export async function deleteChat(chatId: number) {
  await db.transaction("rw", db.chats, db.messages, async () => {
    await db.messages.where({ chatId }).delete();
    await db.chats.delete(chatId);
  });
}

export async function deleteExam(examId: number) {
  await db.exams.delete(examId);
}

/** Full JSON backup of every table. */
export async function exportAll() {
  const out: Record<string, unknown[]> = {};
  for (const t of db.tables) out[t.name] = await t.toArray();
  return { app: "amityexams", version: 1, exportedAt: new Date().toISOString(), data: out };
}

const MAX_BACKUP_ROWS = 200_000;
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Tables older versions of the app exported but that no longer exist (flashcards and study sessions were removed). Skipped on import. */
const LEGACY_TABLES = new Set(["flashcards", "sessions"]);

/** Check a parsed backup before anything is cleared: known tables only, arrays of plain objects, sane size. */
export function validateBackup(backup: unknown): Record<string, Record<string, unknown>[]> {
  if (!isPlainObject(backup) || backup.app !== "amityexams" || !isPlainObject(backup.data)) {
    throw new Error("Not an Amity Exams backup file");
  }
  const data = Object.fromEntries(Object.entries(backup.data).filter(([k]) => !LEGACY_TABLES.has(k)));
  const known = new Set(db.tables.map((t) => t.name));
  const unknown = Object.keys(data).filter((k) => !known.has(k));
  if (unknown.length) throw new Error(`Backup contains unknown data (${unknown.slice(0, 3).join(", ")}). Was it made by this app?`);
  let total = 0;
  for (const [name, rows] of Object.entries(data)) {
    if (!Array.isArray(rows) || !rows.every(isPlainObject)) throw new Error(`Backup table "${name}" is malformed`);
    total += rows.length;
  }
  if (total > MAX_BACKUP_ROWS) throw new Error("Backup is too large to import");
  const settings = data.settings as Record<string, unknown>[] | undefined;
  if (settings?.some((s) => s.id !== "settings")) throw new Error('Backup table "settings" is malformed');
  // Rows are checked too: one bad exam date or exam mode would otherwise crash Today on every launch.
  const isId = (v: unknown) => Number.isSafeInteger(v) && (v as number) > 0;
  for (const [name, rows] of Object.entries(data) as [string, Record<string, unknown>[]][]) {
    if (name === "settings" || name === "driveFiles") continue;
    if (rows.some((r) => (r.id !== undefined && !isId(r.id)) || (r.subjectId !== undefined && !isId(r.subjectId)))) {
      throw new Error(`Backup table "${name}" is malformed`);
    }
  }
  const exams = (data.exams ?? []) as Record<string, unknown>[];
  if (exams.some((e) => !isId(e.subjectId) || typeof e.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date))) {
    throw new Error('Backup table "exams" has an exam without a valid subject or date');
  }
  // Repair what can be repaired rather than refuse the whole file.
  for (const e of exams) {
    e.topicIds = Array.isArray(e.topicIds) ? e.topicIds.filter(isId) : [];
    e.checklist = Array.isArray(e.checklist) ? e.checklist.filter((c) => isPlainObject(c) && typeof c.text === "string") : [];
  }
  for (const s of settings ?? []) if (s.examMode !== undefined && s.examMode !== "mid-term" && s.examMode !== "end-term") delete s.examMode; // asked again on launch
  // Drive settings and the sync map over these, so a wrong shape would crash Settings (and its import button) for good.
  const isFolderId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{10,}$/.test(v);
  for (const s of settings ?? []) {
    if (s.driveSources === undefined) continue;
    if (Array.isArray(s.driveSources)) {
      s.driveSources = s.driveSources.filter((x) => isPlainObject(x) && isFolderId(x.id) && typeof x.label === "string").slice(0, MAX_DRIVE_SOURCES);
    } else delete s.driveSources; // back to the default folders; [] would mean the student removed them all
  }
  for (const r of (data.subjects ?? []) as Record<string, unknown>[]) {
    if (r.driveFolderIds !== undefined) r.driveFolderIds = Array.isArray(r.driveFolderIds) ? r.driveFolderIds.filter(isFolderId) : [];
  }
  return data as Record<string, Record<string, unknown>[]>;
}

export async function importAll(backup: unknown) {
  const data = validateBackup(backup); // throws before any existing data is touched
  await db.transaction("rw", db.tables, async () => {
    for (const t of db.tables) {
      await t.clear();
      const rows = data[t.name];
      if (rows?.length) await t.bulkAdd(rows);
    }
  });
}

export async function clearAll() {
  await db.transaction("rw", db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
}
