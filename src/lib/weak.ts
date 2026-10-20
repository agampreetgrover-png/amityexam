import { db } from "./db";
import { isWeak } from "./stats";

/** Recompute the `weak` flag for topics from confidence + their last 3 quiz scores. */
export async function refreshWeak(topicIds: number[]) {
  const quizzes = await db.quizzes.orderBy("createdAt").reverse().toArray();
  for (const id of topicIds) {
    const t = await db.topics.get(id);
    if (!t) continue;
    const scores = quizzes.filter((q) => q.topicIds.includes(id)).slice(0, 3).map((q) => q.score);
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : undefined;
    const weak = isWeak(t.confidence, avg);
    if (weak !== !!t.weak) await db.topics.update(id, { weak });
  }
}
