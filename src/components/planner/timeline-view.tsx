"use client";

import { Empty, List, Progress, cn } from "@/components/ui";
import { daysBetween, prettyDay, today } from "@/lib/dates";
import { examTypeLabel } from "@/lib/exams";
import { examInMode, useExamMode } from "@/lib/mode";
import { examSyllabus } from "@/lib/planner";
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
  const mode = useExamMode();
  const units = [...lookup.units.values()];
  const upcoming = exams.filter((e) => e.date >= t && examInMode(e, mode)).sort((a, b) => a.date.localeCompare(b.date));
  if (!upcoming.length) return <Empty title="No upcoming exams">Add exams to see the countdown.</Empty>;

  // A topic studied for two exams (say an internal and the mid-term) counts toward the earliest one only,
  // so the same sessions aren't shown as progress twice.
  const syllabi = upcoming.map((e) => new Set(examSyllabus(e, topics, units, mode).map((x) => x.id!)));
  const owner = new Map<number, number>();
  upcoming.forEach((e, i) => syllabi[i].forEach((id) => { if (!owner.has(id)) owner.set(id, e.id!); }));

  return (
    <List>
      {upcoming.map((e, i) => {
        const subject = lookup.subjects.get(e.subjectId);
        const ids = syllabi[i];
        const related = sessions.filter((s) =>
          s.kind === "revision" ? s.examId === e.id : s.topicId != null && owner.get(s.topicId) === e.id,
        );
        const planned = related.reduce((a, s) => a + s.plannedMins, 0);
        const done = related.filter((s) => s.done).reduce((a, s) => a + Math.min(s.actualMins, s.plannedMins), 0);
        const days = daysBetween(t, e.date);
        return (
          <li key={e.id} className="flex items-center gap-4 py-4 pl-1 pr-1 transition-colors duration-150 hover:bg-surface-2 sm:gap-6 sm:pl-2 sm:pr-2">
            <div className="w-16 shrink-0 text-right sm:w-[4.5rem]">
              <p className="numeral text-[40px] sm:text-[44px]">
                <span className={cn(days <= 3 && "mark")}>{days}</span>
              </p>
              <p className="mt-1 text-xs text-muted">{days === 0 ? "today" : days === 1 ? "day left" : "days left"}</p>
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex min-w-0 items-center gap-2 text-[15px] font-semibold">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: subject?.color }} />
                <span className="truncate">{subject?.name ?? "Exam"}</span>
                <span className="shrink-0 text-[13px] font-normal text-muted">{examTypeLabel(e.type)}</span>
              </p>
              <p className="mt-0.5 text-[13px] tabular-nums text-muted">
                {prettyDay(e.date)}{e.time ? `, ${e.time}` : ""}, {ids.size} topic{ids.size === 1 ? "" : "s"}
              </p>
              <div className="mt-2.5 sm:flex sm:items-center sm:gap-3">
                <Progress value={planned ? (done / planned) * 100 : 0} className="sm:max-w-sm sm:flex-1" />
                <p className="mt-1.5 text-xs tabular-nums text-muted sm:mt-0 sm:shrink-0">{fmtMins(done)} of {fmtMins(planned)} planned study done</p>
              </div>
            </div>
          </li>
        );
      })}
    </List>
  );
}
