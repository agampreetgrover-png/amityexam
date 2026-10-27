"use client";

// Rates syllabus topics with AI for the Zero prep page: how much groundwork each needs, how long it takes,
// how much it matters. Ratings are saved on the topic, so each topic costs one look, whatever the exam mode.
import { useSyncExternalStore } from "react";
import { AiError, aiJson } from "./ai/client";
import { db } from "./db";
import type { PrepLevel, Topic, TopicPrep } from "./types";

interface PrepRunState {
  running: boolean;
  message: string;
  error: unknown;
  done: number;
  total: number;
}

const IDLE: PrepRunState = { running: false, message: "", error: null, done: 0, total: 0 };
let state = IDLE;
const listeners = new Set<() => void>();
const set = (patch: Partial<PrepRunState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export function usePrepRun(): PrepRunState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
    () => IDLE,
  );
}

const BATCH = 60; // a typical subject's whole syllabus in one request, so "learn first" can name its neighbours

/** Daily/minute limits (or no AI key) end the run; anything else only skips one batch. */
const isLimit = (e: unknown) => e instanceof AiError && (!!e.retryAfter || /limit|quota|rate|no ai key|api_key/i.test(e.message));

/**
 * Rate topics that haven't been rated yet (or every topic, with `again`), one subject at a time.
 * A topic keeps its old rating until a new one arrives, so a failed run never loses anything.
 */
export async function ratePrep({ again = false, subjectId }: { again?: boolean; subjectId?: number } = {}) {
  if (state.running) return;
  set({ ...IDLE, running: true, message: "Looking at your syllabus…" });
  try {
    const [subjects, units, topics] = await Promise.all([db.subjects.orderBy("name").toArray(), db.units.toArray(), db.topics.toArray()]);
    const unitTitle = new Map(units.map((u) => [u.id, u.title]));
    const order = new Map(units.map((u) => [u.id, u.order]));
    const jobs = subjects
      .filter((s) => subjectId === undefined || s.id === subjectId)
      .map((s) => ({
        subject: s,
        topics: topics
          .filter((t) => t.subjectId === s.id && (again || !t.prep))
          .sort((a, b) => (order.get(a.unitId) ?? 0) - (order.get(b.unitId) ?? 0)),
      }))
      .filter((j) => j.topics.length);
    const total = jobs.reduce((a, j) => a + j.topics.length, 0);
    set({ total });
    let rated = 0;
    let skipped = 0;
    for (const { subject, topics: todo } of jobs) {
      for (let i = 0; i < todo.length; i += BATCH) {
        const batch = todo.slice(i, i + BATCH);
        set({ message: `Rating ${subject.name} topics…` });
        try {
          const res = await aiJson("prep", {
            subject: subject.name,
            topics: batch.map((t) => (unitTitle.get(t.unitId) ? `${t.title} (${unitTitle.get(t.unitId)})` : t.title)),
          });
          rated += await save(batch, res.topics);
        } catch (e) {
          if (isLimit(e)) throw e;
          skipped += batch.length;
        }
        set({ done: state.done + batch.length });
      }
    }
    set({
      done: total,
      message: !total
        ? "Every topic is already rated."
        : skipped
          ? `${rated} topic${rated === 1 ? "" : "s"} rated. ${skipped} couldn't be rated this time; try again.`
          : `${rated} topic${rated === 1 ? "" : "s"} rated.`,
    });
  } catch (e) {
    set({ error: e, message: "" });
  } finally {
    set({ running: false });
  }
}

/** Write the AI's ratings back to their topics. Topics deleted meanwhile, or skipped by the AI, are left alone. */
async function save(batch: Topic[], results: { i: number; prep: number; mins: number | null; imp: number; needs: string | null; why: string | null }[]) {
  let n = 0;
  const at = Date.now();
  await db.transaction("rw", db.topics, async () => {
    for (const r of results) {
      const t = batch[r.i];
      if (!t) continue;
      const level = r.prep as PrepLevel;
      const prep: TopicPrep = {
        level,
        mins: Math.min(180, Math.max(5, r.mins ?? (level === 0 ? 20 : 45))),
        importance: r.imp as TopicPrep["importance"],
        ...(level && r.needs ? { needs: r.needs.slice(0, 160) } : {}),
        ...(r.why ? { why: r.why.slice(0, 300) } : {}),
        at,
      };
      n += await db.topics.update(t.id, { prep });
    }
  });
  return n;
}
