import Dexie, { type EntityTable } from "dexie";
import {
  DEFAULT_SETTINGS,
  type ChatMessage, type Exam, type Flashcard, type GeneratedDoc, type Material,
  type QuizAttempt, type Settings, type StudySession, type Subject, type Topic, type Unit,
} from "./types";

class ExamDB extends Dexie {
  subjects!: EntityTable<Subject, "id">;
  units!: EntityTable<Unit, "id">;
  topics!: EntityTable<Topic, "id">;
  exams!: EntityTable<Exam, "id">;
  sessions!: EntityTable<StudySession, "id">;
  materials!: EntityTable<Material, "id">;
  flashcards!: EntityTable<Flashcard, "id">;
  quizzes!: EntityTable<QuizAttempt, "id">;
  docs!: EntityTable<GeneratedDoc, "id">;
  messages!: EntityTable<ChatMessage, "id">;
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
  }
}

export const db = new ExamDB();

export async function getSettings(): Promise<Settings> {
  return (await db.settings.get("settings")) ?? DEFAULT_SETTINGS;
}

/** Delete a subject and everything hanging off it. */
export async function deleteSubject(subjectId: number) {
  await db.transaction("rw", [db.subjects, db.units, db.topics, db.exams, db.sessions, db.materials, db.flashcards, db.quizzes, db.docs, db.messages], async () => {
    const topicIds = (await db.topics.where({ subjectId }).primaryKeys()) as number[];
    const examIds = (await db.exams.where({ subjectId }).primaryKeys()) as number[];
    await db.sessions.where("topicId").anyOf(topicIds).delete();
    await db.sessions.where("examId").anyOf(examIds).delete();
    for (const table of [db.units, db.topics, db.exams, db.materials, db.flashcards, db.quizzes, db.docs, db.messages]) {
      await (table as Dexie.Table<{ subjectId: number }>).where({ subjectId }).delete();
    }
    await db.subjects.delete(subjectId);
  });
}

/** Delete an exam with its revision sessions. */
export async function deleteExam(examId: number) {
  await db.transaction("rw", db.exams, db.sessions, async () => {
    await db.sessions.where("examId").equals(examId).delete();
    await db.exams.delete(examId);
  });
}

/** Full JSON backup of every table. */
export async function exportAll() {
  const out: Record<string, unknown[]> = {};
  for (const t of db.tables) out[t.name] = await t.toArray();
  return { app: "amityexams", version: 1, exportedAt: new Date().toISOString(), data: out };
}

const MAX_BACKUP_ROWS = 200_000;
const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Check a parsed backup before anything is cleared: known tables only, arrays of plain objects, sane size. */
function validateBackup(backup: unknown): Record<string, Record<string, unknown>[]> {
  if (!isPlainObject(backup) || backup.app !== "amityexams" || !isPlainObject(backup.data)) {
    throw new Error("Not an Amity Exams backup file");
  }
  const known = new Set(db.tables.map((t) => t.name));
  const unknown = Object.keys(backup.data).filter((k) => !known.has(k));
  if (unknown.length) throw new Error(`Backup contains unknown data (${unknown.slice(0, 3).join(", ")}). Was it made by this app?`);
  let total = 0;
  for (const [name, rows] of Object.entries(backup.data)) {
    if (!Array.isArray(rows) || !rows.every(isPlainObject)) throw new Error(`Backup table "${name}" is malformed`);
    total += rows.length;
  }
  if (total > MAX_BACKUP_ROWS) throw new Error("Backup is too large to import");
  const settings = backup.data.settings as Record<string, unknown>[] | undefined;
  if (settings?.some((s) => s.id !== "settings")) throw new Error('Backup table "settings" is malformed');
  return backup.data as Record<string, Record<string, unknown>[]>;
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
