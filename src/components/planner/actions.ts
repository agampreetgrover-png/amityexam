import { db } from "@/lib/db";
import { today } from "@/lib/dates";
import { review } from "@/lib/srs";
import type { StudySession } from "@/lib/types";

/** Mark a session done; when every session of its topic is done, the topic counts as studied. */
export async function completeSession(s: StudySession, actualMins: number) {
  if (s.id == null) return;
  await db.sessions.update(s.id, { done: true, actualMins: Math.max(0, Math.round(actualMins)) });
  if (s.kind !== "study" || s.topicId == null) return;
  const rest = await db.sessions.where("topicId").equals(s.topicId).and((x) => !x.done).count();
  if (rest > 0) return;
  const t = await db.topics.get(s.topicId);
  if (!t) return;
  const d = today();
  const next = review(t, 4, d);
  await db.topics.update(s.topicId, {
    status: t.status === "not-started" ? "studied" : t.status,
    lastReviewed: d,
    nextReview: next.due,
    ease: next.ease,
    interval: next.interval,
    reps: next.reps,
  });
}

export async function undoSession(s: StudySession) {
  if (s.id == null) return;
  await db.sessions.update(s.id, { done: false, actualMins: 0 });
}

export async function addFocusMinutes(sessionId: number, mins: number) {
  const s = await db.sessions.get(sessionId);
  if (s) await db.sessions.update(sessionId, { actualMins: s.actualMins + mins });
}
