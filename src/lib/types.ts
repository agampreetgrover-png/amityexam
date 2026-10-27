// Dates are stored as "yyyy-MM-dd" strings (local day) to avoid timezone drift.
export type ISODay = string;

export type TopicStatus = "not-started" | "studied" | "revised";
export type ExamType = "internal" | "mid-term" | "end-term" | "practical" | "viva" | "other";
/** Which exam season the app is tailored to, chosen on first launch. */
export type ExamMode = "mid-term" | "end-term";

export interface Subject {
  id?: number;
  name: string;
  code?: string;
  credits?: number;
  color: string;
  createdAt: number;
  driveFolderIds?: string[]; // Drive folders linked by hand, on top of the auto-matched ones
}

export interface Unit {
  id?: number;
  subjectId: number;
  title: string;
  order: number;
  exam?: ExamMode; // whose syllabus this unit belongs to; legacy units (unset) are the major syllabus
}

export interface Topic {
  id?: number;
  subjectId: number;
  unitId: number;
  title: string;
  confidence: number; // 1–5
  status: TopicStatus;
  weak?: boolean; // set from quiz scores / low confidence
  prep?: TopicPrep; // how much groundwork it needs, rated by AI for the Zero prep page
}

/** 0 = learn it cold, 1 = a little groundwork first, 2 = builds on other topics. */
export type PrepLevel = 0 | 1 | 2;

/** AI's read on a topic: how much it needs before it, how long it takes, how much it matters. */
export interface TopicPrep {
  level: PrepLevel;
  mins: number; // to learn it to exam standard
  importance: 1 | 2 | 3; // 3 = core, 1 = minor
  needs?: string; // what to learn first (levels 1 and 2)
  why?: string;
  at: number;
}

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface Exam {
  id?: number;
  subjectId: number;
  type: ExamType;
  date: ISODay;
  time?: string; // "HH:mm"
  durationMins?: number;
  venue?: string;
  seat?: string;
  topicIds: number[]; // empty = whole subject
  checklist: ChecklistItem[];
  notes?: string;
}

export type MaterialKind = "notes" | "pyq" | "syllabus" | "other";

export interface Material {
  id?: number;
  subjectId: number;
  kind: MaterialKind;
  fileName: string;
  text: string;
  createdAt: number;
  pyqExam?: ExamMode; // which exam a past paper was for, when its name says so
  source?: DriveRef; // set when imported from Google Drive
  analysedAt?: number; // past paper split into questions (see PyqQuestion)
  paperYear?: number; // exam year read from the paper itself
}

export interface DriveRef {
  driveId: string;
  url: string;
  path: string[]; // folder names in Drive, e.g. ["CSE201 - Database Management Systems", "PYQs"]
  format: "notes" | "ppt" | "pyq";
  ocr: boolean; // read from a scan by AI
}

/** One question from a past paper, for the year-wise and topic-wise question bank. */
export interface PyqQuestion {
  id?: number;
  subjectId: number;
  materialId: number;
  year?: number;
  exam?: ExamMode;
  number: string; // as printed, e.g. "Q2(b)"
  section?: string; // e.g. "Section B"
  text: string;
  marks?: number;
  topicId?: number | null; // null = checked, matches no syllabus topic; undefined = not mapped yet
}

/** Every Drive file the sync has dealt with, so deleted or skipped files aren't fetched again. */
export interface DriveFile {
  driveId: string;
  subjectId: number;
  name: string;
  status: "imported" | "skipped";
  reason?: string;
  at: number;
}

export interface DriveSourceSetting {
  id: string; // folder id
  label: string;
}

export interface QuizQuestion {
  type: "mcq" | "short";
  question: string;
  options?: string[];
  answer: string; // correct option text or model answer
  explanation?: string;
}

export interface QuizAttempt {
  id?: number;
  subjectId: number;
  topicIds: number[];
  questions: QuizQuestion[];
  responses: string[];
  score: number; // 0–100
  createdAt: number;
}

type GeneratedKind = "summary" | "cheatsheet" | "predict";

export interface GeneratedDoc {
  id?: number;
  subjectId: number;
  topicId?: number;
  kind: GeneratedKind;
  title: string;
  content: string; // markdown
  createdAt: number;
}

export interface ChatMessage {
  id?: number;
  subjectId: number;
  chatId?: number; // a study-chat conversation; unset = the subject page's own chat
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  sources?: ChatSource[]; // what an answer was based on (study chat)
}

/** One conversation in the study chat, kept so the student can come back to it. */
export interface Chat {
  id?: number;
  subjectId: number;
  title: string; // the first question, until renamed
  createdAt: number;
  updatedAt: number;
}

export interface ChatSource {
  kind: "notes" | "pyq";
  label: string; // file name, or e.g. "2023 · Q3(b) · 10 marks"
}

export interface Settings {
  id: "settings";
  notifications: boolean;
  examMode?: ExamMode; // unset until chosen on the welcome screen
  driveSources?: DriveSourceSetting[]; // unset = the built-in defaults
  driveSync?: boolean; // sync Drive on open; unset = on
  lastDriveSync?: number;
}

export const DEFAULT_SETTINGS: Settings = {
  id: "settings",
  notifications: false,
};
