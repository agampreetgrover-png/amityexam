"use client";

import { Empty, List, Progress, cn } from "@/components/ui";
import { daysBetween, prettyDay, today } from "@/lib/dates";
import { examTypeLabel } from "@/lib/exams";
import { examTopics } from "@/lib/planner";
import { fmtMins } from "@/lib/stats";
import type { Exam, StudySession, Topic } from "@/lib/types";
import type { Lookup } from "./lookup";

/** Per-exam countdown with planned vs done minutes for the topics it covers. */
export function TimelineView({ exams, topics, sessions, lookup }: {
  exams: Exam[];
  topics: Topic[];
  sessions: StudySession[];
  lookup: Lookup;
}) {
  const t = today();
  const upcoming = exams.filter((e) => e.date >= t).sort((a, b) => a.date.localeCompare(b.date));
  if (!upcoming.length) return <Empty title="No upcoming exams">Add exams to see the countdown.</Empty>;

  return (
    <List>
      {upcoming.map((e) => {
        const subject = lookup.subjects.get(e.subjectId);
        const ids = new Set(examTopics(e, topics).map((x) => x.id));
        const related = sessions.filter((s) => (s.topicId != null && ids.has(s.topicId)) || s.examId === e.id);
        const planned = related.reduce((a, s) => a + s.plannedMins, 0);
        const done = related.filter((s) => s.done).reduce((a, s) => a + Math.min(s.actualMins, s.plannedMins), 0);
        const days = daysBetween(t, e.date);
        return (
          <li key={e.id} className="flex items-center gap-5 py-4">
            <div className="w-16 shrink-0 text-right">
              <p className="numeral text-[44px]"><span className={cn(days <= 3 && "mark")}>{days}</span></p>
              <p className="mt-1 text-xs text-muted">{days === 0 ? "today" : days === 1 ? "day left" : "days left"}</p>
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-semibold">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: subject?.color }} />
                <span className="truncate">{subject?.name ?? "Exam"}</span>
                <span className="shrink-0 text-sm font-normal text-muted">{examTypeLabel(e.type)}</span>
              </p>
              <p className="mt-0.5 text-[13px] text-muted">
                {prettyDay(e.date)}{e.time ? `, ${e.time}` : ""}, {ids.size} topics
              </p>
              <Progress value={planned ? (done / planned) * 100 : 0} className="mt-2.5" color={subject?.color} />
              <p className="mt-1 text-xs tabular-nums text-muted">{fmtMins(done)} of {fmtMins(planned)} planned study done</p>
            </div>
          </li>
        );
      })}
    </List>
  );
}
