import { db } from "@/lib/db";
import { today } from "@/lib/dates";
import { review } from "@/lib/srs";
import type { StudySession, Topic } from "@/lib/types";

type TopicSnapshot = Pick<Topic, "status" | "lastReviewed" | "nextReview" | "ease" | "interval" | "reps">;

/** What completeSession changed, so undoSession can put it back exactly. */
export interface UndoToken {
  sessionId: number;
  session: Pick<StudySession, "done" | "actualMins">;
  topic?: { id: number; prev: TopicSnapshot };
}

// The latest completion per session, so any Undo while the app is open restores the topic and timer minutes too.
const lastCompletion = new Map<number, UndoToken>();

/** Mark a session done; when every session of its topic is done, the topic counts as studied. */
export async function completeSession(s: StudySession, actualMins: number): Promise<UndoToken | undefined> {
  if (s.id == null) return;
  const before = await db.sessions.get(s.id);
  const token: UndoToken = { sessionId: s.id, session: { done: before?.done ?? s.done, actualMins: before?.actualMins ?? s.actualMins } };
  lastCompletion.set(s.id, token);
  await db.sessions.update(s.id, { done: true, actualMins: Math.max(0, Math.round(actualMins)) });
  if (s.kind !== "study" || s.topicId == null) return token;
  const rest = await db.sessions.where("topicId").equals(s.topicId).and((x) => !x.done).count();
  if (rest > 0) return token;
  const t = await db.topics.get(s.topicId);
  if (!t) return token;
  token.topic = {
    id: s.topicId,
    prev: { status: t.status, lastReviewed: t.lastReviewed, nextReview: t.nextReview, ease: t.ease, interval: t.interval, reps: t.reps },
  };
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
  return token;
}

/**
 * Mark a session not done. With a record of how it was completed (passed in, or remembered from this visit),
 * the session's minutes and its topic's study state go back to exactly what they were.
 */
export async function undoSession(s: StudySession, token = s.id != null ? lastCompletion.get(s.id) : undefined) {
  if (s.id == null) return;
  if (!token || token.sessionId !== s.id) {
    await db.sessions.update(s.id, { done: false, actualMins: 0 });
    return;
  }
  lastCompletion.delete(s.id);
  await db.transaction("rw", db.sessions, db.topics, async () => {
    // Undo means "not done", even if it was already done before this completion.
    await db.sessions.update(token.sessionId, { done: false, actualMins: token.session.actualMins });
    if (token.topic) await db.topics.update(token.topic.id, token.topic.prev);
  });
}

export async function addFocusMinutes(sessionId: number, mins: number) {
  // One read-modify-write request, started synchronously: it's also called while the tab is closing.
  await db.sessions.where(":id").equals(sessionId).modify((s) => {
    s.actualMins += mins;
  });
}
