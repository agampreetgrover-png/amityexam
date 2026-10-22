"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button, cn } from "@/components/ui";
import { addDay, prettyDay, today, weekday } from "@/lib/dates";
import { fmtMins } from "@/lib/stats";
import type { Exam, StudySession } from "@/lib/types";
import { describeSession, type Lookup } from "./lookup";

/** Monday of the week containing `d`. */
const weekStart = (d: string) => addDay(d, -((weekday(d) + 6) % 7));

export function WeekView({ sessions, exams, lookup, dailyMinutes }: {
  sessions: StudySession[];
  exams: Exam[];
  lookup: Lookup;
  dailyMinutes: number;
}) {
  const [start, setStart] = useState(() => weekStart(today()));
  const days = Array.from({ length: 7 }, (_, i) => addDay(start, i));
  const t = today();

  return (
    <section>
      <div className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-[15px] font-semibold tabular-nums">{prettyDay(days[0])} to {prettyDay(days[6])}</h2>
        <div className="flex gap-1">
          <Button variant="secondary" size="sm" onClick={() => setStart(addDay(start, -7))} aria-label="Previous week"><ChevronLeft size={16} /></Button>
          <Button variant="secondary" size="sm" onClick={() => setStart(weekStart(today()))}>This week</Button>
          <Button variant="secondary" size="sm" onClick={() => setStart(addDay(start, 7))} aria-label="Next week"><ChevronRight size={16} /></Button>
        </div>
      </div>
      {/* Seven columns don't fit a phone, so the grid scrolls sideways inside its own box. */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <div className="grid min-w-[840px] grid-cols-7 divide-x divide-border">
          {days.map((d) => {
            const list = sessions.filter((s) => s.date === d);
            const total = list.reduce((a, s) => a + s.plannedMins, 0);
            const examsToday = exams.filter((e) => e.date === d);
            const isToday = d === t;
            return (
              <div key={d} className="flex min-h-44 flex-col">
                {/* Header strip; today's column carries a navy rule along its top. */}
                <div
                  className={cn(
                    "border-b border-border bg-surface-2 px-2.5 pb-2 pt-2",
                    isToday && "border-t-2 border-t-accent pt-1.5",
                  )}
                  aria-current={isToday ? "date" : undefined}
                >
                  <p className={cn("text-[13px]", isToday ? "font-semibold text-accent" : "font-medium text-text")}>
                    {prettyDay(d)}
                  </p>
                  <p className={cn("mt-0.5 text-xs tabular-nums", total > dailyMinutes ? "font-medium text-bad" : "text-muted")}>
                    {fmtMins(total)} of {fmtMins(dailyMinutes)}
                  </p>
                </div>
                <ul className="space-y-1.5 p-2">
                  {examsToday.map((e) => (
                    <li
                      key={`e${e.id}`}
                      className="rounded border border-accent px-1.5 py-1 text-xs font-semibold leading-snug text-accent"
                    >
                      {lookup.subjects.get(e.subjectId)?.name ?? "Exam"} exam
                      {e.time && <span className="block font-normal tabular-nums">{e.time}</span>}
                    </li>
                  ))}
                  {list.map((s) => {
                    const { title, subject } = describeSession(s, lookup);
                    return (
                      <li
                        key={s.id}
                        className={cn(
                          "border-l-2 py-0.5 pl-2 text-xs leading-snug",
                          s.done && "text-muted line-through decoration-muted/60 opacity-70",
                        )}
                        style={{ borderColor: subject?.color ?? "var(--muted)" }}
                        title={title}
                      >
                        <span className="line-clamp-2">{title}</span>
                        <span className="tabular-nums text-muted">{fmtMins(s.plannedMins)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
