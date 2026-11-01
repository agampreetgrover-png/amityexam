import Dexie, { type EntityTable } from "dexie";
import {
  DEFAULT_SETTINGS,
  type Chat, type ChatMessage, type DriveFile, type Exam, type PyqQuestion, type GeneratedDoc, type Material,
  type QuizAttempt, type Settings, type Subject, type Topic, type Unit,
} from "./types";
import { MAX_DRIVE_SOURCES } from "./drive/sources";
import { dbNameOf, ownerOf, type Profile } from "./profile";

/** The tables holding the student's data: what export, import and "clear all" work on. `meta` is never among them. */
export const DATA_TABLES = [
  "subjects", "units", "topics", "exams", "materials", "driveFiles", "pyqQuestions", "quizzes", "docs", "messages", "chats", "settings",
] as const;

/** Bookkeeping that belongs to this database itself, e.g. { key: "owner", value: "local" | userId }. */
interface MetaRow {
  key: string;
  value: string;
}

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
  meta!: EntityTable<MetaRow, "key">;

  constructor(name: string) {
    super(name);
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
    this.version(7).stores({ meta: "key" }); // which profile this database belongs to; existing tables are untouched
  }
}

export class OwnerMismatchError extends Error {
  constructor(public expected: string, public found: string) {
    super("This browser database belongs to a different profile, so it wasn't opened.");
  }
}

let current: ExamDB | null = null;

/**
 * Open the database for this page load (called once, by ProfileGate, in the browser). Its owner marker is written
 * when it is first opened and checked on every open after that: a mismatch closes it without writing anything.
 */
export async function openDb(profile: Profile): Promise<void> {
  const name = dbNameOf(profile);
  if (current) {
    if (current.name === name) return;
    throw new Error("Another profile's database is already open; switching profiles needs a page reload.");
  }
  const instance = new ExamDB(name);
  const expected = ownerOf(profile);
  try {
    const found = await instance.transaction("rw", instance.meta, async () => {
      const row = await instance.meta.get("owner");
      if (row) return row.value;
      await instance.meta.add({ key: "owner", value: expected });
      return expected;
    });
    if (found !== expected) throw new OwnerMismatchError(expected, found);
  } catch (e) {
    instance.close();
    throw e;
  }
  current = instance;
}

/** For tests: forget the open database so another can be opened. */
export function closeDbForTests() {
  current?.close();
  current = null;
}

// Every module imports `db`; it forwards to the database openDb() chose. Using it before that (on the server, or
// before ProfileGate has finished) throws instead of quietly opening some default database.
export const db = new Proxy({} as ExamDB, {
  get(_target, prop) {
    if (!current) throw new Error("DB not opened: the browser database is opened by ProfileGate before the app renders.");
    const value = Reflect.get(current, prop, current);
    return typeof value === "function" ? value.bind(current) : value;
  },
});

const dataTables = () => DATA_TABLES.map((name) => db.table(name));

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
  for (const t of dataTables()) out[t.name] = await t.toArray();
  return { app: "amityexams", version: 1, exportedAt: new Date().toISOString(), data: out };
}

const MAX_BACKUP_ROWS = 200_000;
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Tables older versions of the app exported but that no longer exist (flashcards and study sessions were removed). Skipped on import. */
const LEGACY_TABLES = new Set(["flashcards", "sessions"]);
/** Fields each row of a table must have as text. */
const TEXT_FIELDS: Record<string, string[]> = {
  subjects: ["name"],
  units: ["title"],
  topics: ["title"],
  materials: ["fileName", "text"],
  driveFiles: ["driveId", "name"],
  pyqQuestions: ["number", "text"],
  docs: ["title", "content"],
  messages: ["role", "content"],
  chats: ["title"],
};

/** Check a parsed backup before anything is cleared: known tables only, arrays of plain objects, sane size. */
export function validateBackup(backup: unknown): Record<string, Record<string, unknown>[]> {
  if (!isPlainObject(backup) || backup.app !== "amityexams" || !isPlainObject(backup.data)) {
    throw new Error("Not an Amity Exams backup file");
  }
  const data = Object.fromEntries(Object.entries(backup.data).filter(([k]) => !LEGACY_TABLES.has(k)));
  const known = new Set<string>(DATA_TABLES); // "meta" is refused: a backup must never carry another profile's owner marker
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
  // The text every page reads (sorting, searching, Markdown): a backup someone shared with a number or an object
  // here would crash those pages on every launch, with no way back short of clearing the site's data.
  for (const [name, fields] of Object.entries(TEXT_FIELDS)) {
    const rows = (data[name] ?? []) as Record<string, unknown>[];
    if (rows.some((r) => fields.some((f) => typeof r[f] !== "string"))) throw new Error(`Backup table "${name}" is malformed`);
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
  await db.transaction("rw", dataTables(), async () => {
    for (const t of dataTables()) {
      await t.clear();
      const rows = data[t.name];
      if (rows?.length) await t.bulkAdd(rows);
    }
  });
}

export async function clearAll() {
  await db.transaction("rw", dataTables(), async () => {
    for (const t of dataTables()) await t.clear();
  });
}
