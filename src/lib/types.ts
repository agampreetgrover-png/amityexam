// Dates are stored as "yyyy-MM-dd" strings (local day) to avoid timezone drift.
export type ISODay = string;

export type TopicStatus = "not-started" | "studied" | "revised";
export type ExamType = "internal" | "mid-term" | "end-term" | "practical" | "viva" | "other";

export interface Subject {
  id?: number;
  name: string;
  code?: string;
  credits?: number;
  color: string;
  createdAt: number;
}

export interface Unit {
  id?: number;
  subjectId: number;
  title: string;
  order: number;
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
}

export interface Flashcard {
  id?: number;
  subjectId: number;
  topicId?: number;
  front: string;
  back: string;
  ease: number;
  interval: number;
  reps: number;
  due: ISODay;
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
