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
  difficulty: number; // 1–5
  confidence: number; // 1–5
  status: TopicStatus;
  weak?: boolean; // set from quiz scores / low confidence
  lastReviewed?: ISODay;
  nextReview?: ISODay;
  // SM-2 fields for topic-level revision
  ease: number;
  interval: number;
  reps: number;
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

type SessionKind = "study" | "revision";

export interface StudySession {
  id?: number;
  date: ISODay;
  topicId?: number; // study session
  examId?: number; // revision session
  kind: SessionKind;
  plannedMins: number;
  actualMins: number;
  done: boolean;
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
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface Settings {
  id: "settings";
  dailyMinutes: number;
  offDays: number[]; // 0 = Sunday
  revisionDays: number; // days before each exam reserved for revision
  sessionMins: number; // max length of one study block
  pomodoroWork: number;
  pomodoroBreak: number;
  notifications: boolean;
  examMode?: ExamMode; // unset until chosen on the welcome screen
  driveSources?: DriveSourceSetting[]; // unset = the built-in defaults
  driveSync?: boolean; // sync Drive on open; unset = on
  lastDriveSync?: number;
}

export const DEFAULT_SETTINGS: Settings = {
  id: "settings",
  dailyMinutes: 240,
  offDays: [],
  revisionDays: 1,
  sessionMins: 60,
  pomodoroWork: 25,
  pomodoroBreak: 5,
  notifications: false,
};
