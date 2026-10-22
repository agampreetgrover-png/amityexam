import { db, getSettings } from "./db";
import { today } from "./dates";
import { generatePlan, type PlanResult } from "./planner";

/**
 * Rebuild the schedule from today. Completed sessions are kept. Unfinished ones (missed past
 * sessions and the old future plan) are replaced: their work flows back into the new plan.
 * Minutes already logged on an unfinished session are kept as a completed partial session.
 */
export async function replan(): Promise<PlanResult> {
  const start = today();
  return db.transaction("rw", [db.exams, db.topics, db.units, db.sessions, db.settings], async () => {
    const unfinished = await db.sessions.filter((s) => !s.done).toArray();
    for (const s of unfinished) {
      if (s.actualMins > 0) await db.sessions.update(s.id, { done: true, plannedMins: s.actualMins });
      else await db.sessions.delete(s.id);
    }
    const [exams, topics, units, done, settings] = await Promise.all([
      db.exams.toArray(),
      db.topics.toArray(),
      db.units.toArray(),
      db.sessions.toArray(),
      getSettings(),
    ]);
    // Plans only for the chosen season; the other season's future sessions are dropped above.
    const result = generatePlan({ start, exams, topics, units, done, settings, mode: settings.examMode });
    await db.sessions.bulkAdd(result.sessions);
    return result;
  });
}
