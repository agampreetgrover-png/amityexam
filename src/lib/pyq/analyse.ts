"use client";

// Splits past papers into questions with AI, then matches each question to a syllabus topic.
import { useSyncExternalStore } from "react";
import { AiError, aiJson } from "../ai/client";
import type { PyqPaperResult } from "../ai/schemas";
import { db } from "../db";
import { pyqMode, topicsInScope } from "../mode";
import type { ExamMode, Material, PyqQuestion, Topic } from "../types";
import { needsMapping, newestFirst, paperYear } from "./group";

interface PyqAnalysisState {
  running: boolean;
  message: string;
  done: number;
  total: number;
}

const IDLE: PyqAnalysisState = { running: false, message: "", done: 0, total: 0 };
let state = IDLE;
const listeners = new Set<() => void>();
const set = (patch: Partial<PyqAnalysisState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export function usePyqAnalysis(): PyqAnalysisState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
    () => IDLE,
  );
}

// ---- AI calls -------------------------------------------------------------------------------

const MAX_PAPER_CHARS = 60_000; // a paper is a few pages; anything longer is mostly OCR noise
const MAP_BATCH = 40;
// What the AI route accepts in `topics` (see AiRequestSchema); anything over is refused outright.
const MAP_TOPICS = 150;
const MAX_TOPIC_CHARS = 300;

// The API route has already checked the reply against PyqPaperSchema; this only caps lengths and fills in gaps.
function cleanPaper(r: PyqPaperResult): PyqPaperResult {
  return {
    ...r,
    questions: r.questions.map((q, i) => ({
      number: q.number.slice(0, 20) || `Q${i + 1}`,
      section: q.section?.slice(0, 40) ?? null,
      text: q.text.slice(0, 4000),
      marks: q.marks || null, // 0 marks: the model didn't know
    })),
  };
}

/** Daily/minute limits (or no AI key at all) end the whole run; other failures only skip one paper. */
const isLimit = (e: unknown) => e instanceof AiError && (!!e.retryAfter || /limit|quota|rate|no ai key|api_key/i.test(e.message));
const offline = () => typeof navigator !== "undefined" && !navigator.onLine;

// Papers the AI failed on this session (bad output, too long…), with why: not retried automatically until
// the app is reopened, so one broken paper doesn't cost a request on every sync and tab visit.
// The PYQs tab shows them, and the student can retry one by hand.
const failedThisSession = new Map<number, string>();
let failedSnapshot: ReadonlyMap<number, string> = new Map();
const fail = (id: number, reason: string) => {
  failedThisSession.set(id, reason);
  failedSnapshot = new Map(failedThisSession);
  listeners.forEach((l) => l());
};
const EMPTY_FAILURES: ReadonlyMap<number, string> = new Map();

/** Papers that couldn't be read this session, by material id, with the reason. */
export function usePaperFailures(): ReadonlyMap<number, string> {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => failedSnapshot,
    () => EMPTY_FAILURES,
  );
}

/** Forget a subject's failures (or one paper's) and analyse again. */
export function retryPapers(subjectId: number, materialIds: number[]) {
  for (const id of materialIds) failedThisSession.delete(id);
  failedSnapshot = new Map(failedThisSession);
  listeners.forEach((l) => l());
  return analyseSubject(subjectId);
}

// ---- Steps (unguarded; the public wrappers below allow one run at a time) -----------------------

async function analysePapersStep(subjectId: number | undefined, max: number): Promise<{ analysed: number; stopped: boolean }> {
  const pending = newestFirst(
    await db.materials
      .filter((m) => m.kind === "pyq" && !m.analysedAt && !failedThisSession.has(m.id!) && (subjectId === undefined || m.subjectId === subjectId))
      .toArray(),
  ).slice(0, max);
  if (!pending.length) return { analysed: 0, stopped: false };
  const names = new Map((await db.subjects.toArray()).map((s) => [s.id!, s.name]));

  let analysed = 0;
  set({ total: pending.length, done: 0 });
  for (const paper of pending) {
    if (offline()) return { analysed, stopped: true };
    set({ message: `Reading questions from ${paper.fileName}…` });
    let result: PyqPaperResult;
    try {
      result = cleanPaper(
        await aiJson("pyq", { subject: names.get(paper.subjectId), context: paper.text.slice(0, MAX_PAPER_CHARS), text: paper.fileName }),
      );
    } catch (e) {
      if (isLimit(e)) {
        set({ message: e instanceof AiError && /key/i.test(e.message) ? e.message : "AI limit reached. The remaining papers will be analysed later." });
        return { analysed, stopped: true };
      }
      // Tried again next time the app opens, or when the student taps Retry.
      fail(paper.id!, e instanceof Error && e.message ? e.message : "The AI couldn't split this paper into questions.");
      set({ done: state.done + 1 }); // a failed paper is still one step through the list
      continue;
    }
    // Saved with no questions, the paper would count as analysed and never be read again.
    if (!result.questions.length) {
      fail(paper.id!, "The AI found no questions in this paper.");
      set({ done: state.done + 1 });
      continue;
    }
    await savePaper(paper, result);
    analysed++;
    set({ done: state.done + 1 });
  }
  return { analysed, stopped: false };
}

async function savePaper(paper: Material, result: PyqPaperResult) {
  const year = result.year ?? paperYear(paper);
  await db.transaction("rw", db.materials, db.pyqQuestions, async () => {
    const current = await db.materials.get(paper.id);
    if (!current) return; // deleted while the AI was reading it
    // Which exam: the tag (Drive or the student) wins, then what the paper itself says, then its file name.
    // It's written back to the paper so the major/mid-sem split stays put.
    const exam = current.pyqExam ?? result.exam ?? pyqMode(current.fileName);
    await db.pyqQuestions.where({ materialId: paper.id! }).delete();
    await db.pyqQuestions.bulkAdd(
      result.questions.map((q): PyqQuestion => ({
        subjectId: paper.subjectId,
        materialId: paper.id!,
        year,
        exam,
        number: q.number,
        section: q.section ?? undefined,
        text: q.text,
        marks: q.marks ?? undefined,
      })),
    );
    await db.materials.update(paper.id, {
      analysedAt: Date.now(),
      ...(result.year ? { paperYear: result.year } : {}),
      ...(!current.pyqExam && exam ? { pyqExam: exam } : {}),
    });
  });
}

/** The student says which exam a paper was for: tag it and its questions, and match them to that exam's syllabus. */
export async function setPaperExam(materialId: number, exam: ExamMode) {
  await db.transaction("rw", db.materials, db.pyqQuestions, async () => {
    await db.materials.update(materialId, { pyqExam: exam });
    await db.pyqQuestions.where({ materialId }).modify((q) => {
      q.exam = exam;
      delete q.topicId; // was never matched (unknown papers aren't), or matched against the wrong syllabus
    });
  });
  const m = await db.materials.get(materialId);
  // While another run is busy it would ignore this call, so queue a full run instead.
  if (running) allQueued = true;
  else if (m) void analyseSubject(m.subjectId);
}

async function mapTopicsStep(subjectId: number): Promise<{ mapped: number; stopped: boolean; error?: string }> {
  const [subject, units, topics, papers, all] = await Promise.all([
    db.subjects.get(subjectId),
    db.units.where({ subjectId }).sortBy("order"),
    db.topics.where({ subjectId }).toArray(),
    db.materials.where({ subjectId }).filter((m) => m.kind === "pyq").toArray(),
    db.pyqQuestions.where({ subjectId }).toArray(),
  ]);
  if (!subject || !topics.length) return { mapped: 0, stopped: false };

  // Each question is matched against its own paper's exam syllabus (the paper's tag is the source of truth).
  // Papers of unknown exam type aren't matched at all: they're shown in neither mode until the student sorts them.
  // A question needs matching when its topic isn't in that exam's syllabus (the same test the PYQs tab uses);
  // checking against every topic would leave one whose unit moved out of scope "not matched" for good.
  const examOf = new Map(papers.map((p) => [p.id!, pyqMode(p)]));
  const scopes = new Map<ExamMode, { scoped: Topic[]; qs: PyqQuestion[] }>();
  for (const exam of new Set(examOf.values())) {
    if (!exam) continue;
    const scoped = topicsInScope(topics, units, exam);
    const ids = new Set(scoped.map((t) => t.id));
    const qs = all.filter((q) => examOf.get(q.materialId) === exam && needsMapping(q, ids));
    if (scoped.length && qs.length) scopes.set(exam, { scoped, qs }); // no syllabus for that exam yet: stays "not matched"
  }
  if (!scopes.size) return { mapped: 0, stopped: false };

  let mapped = 0;
  let error: string | undefined;
  set({ total: [...scopes.values()].reduce((a, s) => a + s.qs.length, 0), done: 0 });
  for (const { scoped, qs } of scopes.values()) {
    const titles = scoped.map((t) => {
      const unit = units.find((u) => u.id === t.unitId)?.title;
      return (unit ? `${t.title} (${unit})` : t.title).slice(0, MAX_TOPIC_CHARS);
    });
    for (let i = 0; i < qs.length; i += MAP_BATCH) {
      if (offline()) return { mapped, stopped: true, error };
      const batch = qs.slice(i, i + MAP_BATCH);
      set({ message: `Matching questions to your ${subject.name} syllabus…` });
      // The API takes so many topics a request, so a long syllabus goes in slices. A question takes the first
      // slice's match, and counts as fitting no topic only once every slice has said so.
      const hit = new Map<number, number>(); // question's index in batch → topic's index in scoped
      const misses = new Map<number, Set<number>>(); // question's index in batch → slices that found no topic
      const slices = Math.ceil(titles.length / MAP_TOPICS);
      for (let k = 0; k < titles.length; k += MAP_TOPICS) {
        let entries: { i: number; t: number }[];
        try {
          ({ map: entries } = await aiJson("pyqmap", {
            subject: subject.name,
            topics: titles.slice(k, k + MAP_TOPICS),
            text: JSON.stringify(batch.map((q, j) => ({ i: j, q: q.text.slice(0, 500) }))),
          }));
        } catch (e) {
          if (isLimit(e)) {
            set({ message: "AI limit reached. The remaining questions will be matched later." });
            return { mapped, stopped: true, error };
          }
          error = e instanceof Error && e.message ? e.message : "the AI request failed";
          continue;
        }
        for (const m of entries) {
          if (!batch[m.i] || hit.has(m.i)) continue;
          if (m.t >= 0 && k + m.t < Math.min(k + MAP_TOPICS, scoped.length)) hit.set(m.i, k + m.t);
          else misses.set(m.i, (misses.get(m.i) ?? new Set()).add(k));
        }
      }
      await db.transaction("rw", db.pyqQuestions, async () => {
        for (const [j, q] of batch.entries()) {
          const t = hit.get(j) ?? (misses.get(j)?.size === slices ? -1 : undefined);
          if (t === undefined) continue; // questions the AI skipped stay unmapped and are retried next time
          // The paper may have been re-tagged while the AI was answering; this match is for the old syllabus then.
          const cur = await db.pyqQuestions.get(q.id!);
          if (!cur || cur.exam !== q.exam || cur.topicId !== q.topicId) continue;
          await db.pyqQuestions.update(q.id, { topicId: t >= 0 ? scoped[t].id! : null });
          mapped++;
        }
      });
      set({ done: mapped });
    }
  }
  return { mapped, stopped: false, error };
}

// ---- Public API ------------------------------------------------------------------------------

let running = false;
let allQueued = false; // analyseAll (or a re-tag) was asked for while another run was busy

/** Run `fn` unless another analysis is already going; resets the status line when done. */
async function exclusive<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (running || offline()) return undefined;
  running = true;
  set({ ...IDLE, running: true, message: "Checking past papers…" });
  try {
    return await fn();
  } catch (e) {
    set({ message: e instanceof Error ? e.message : "Analysis failed" });
    return undefined;
  } finally {
    running = false;
    set({ running: false });
    // Whatever run just ended (a subject's, from the PYQs tab, or a full one), work queued meanwhile goes next.
    if (allQueued) {
      allQueued = false;
      setTimeout(() => void analyseAll(), 0);
    }
  }
}

const finalMessage = (papers: number, mapped: number, stopped: boolean, mapError?: string) =>
  set({
    message: stopped
      ? state.message
      : papers || mapped || mapError
        ? [
            papers && `${papers} paper${papers === 1 ? "" : "s"} analysed`,
            mapped && `${mapped} question${mapped === 1 ? "" : "s"} matched to topics`,
            mapError && `Some questions couldn't be matched (${mapError})`,
          ].filter(Boolean).join(" · ")
        : "",
  });

/** Analyse a subject's new papers, then match their questions to topics. */
export const analyseSubject = (subjectId: number, { max = 8 } = {}) =>
  exclusive(async () => {
    const a = await analysePapersStep(subjectId, max);
    const m = a.stopped ? { mapped: 0, stopped: true, error: undefined } : await mapTopicsStep(subjectId);
    finalMessage(a.analysed, m.mapped, a.stopped || m.stopped, m.error);
  });

/** Every subject: new papers first (newest year first, capped per run), then topic matching. */
export const analyseAll = async ({ max = 12 } = {}): Promise<void> => {
  if (running) {
    allQueued = true; // picked up when the current run ends
    return;
  }
  await exclusive(async () => {
    const a = await analysePapersStep(undefined, max);
    let mapped = 0;
    let mapError: string | undefined;
    let stopped = a.stopped;
    if (!stopped) {
      for (const s of await db.subjects.toArray()) {
        const m = await mapTopicsStep(s.id!);
        mapped += m.mapped;
        mapError = m.error ?? mapError;
        if (m.stopped) {
          stopped = true;
          break;
        }
      }
    }
    finalMessage(a.analysed, mapped, stopped, mapError);
  });
};

/** Forget every topic match for a subject and match again (after the syllabus changed). */
export const remapSubject = (subjectId: number) =>
  exclusive(async () => {
    await db.pyqQuestions.where({ subjectId }).modify((q) => {
      delete q.topicId;
    });
    const m = await mapTopicsStep(subjectId);
    finalMessage(0, m.mapped, m.stopped, m.error);
  });
