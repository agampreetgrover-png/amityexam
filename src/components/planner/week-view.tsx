"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Button, Section, cn } from "@/components/ui";
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
    <Section
      title={`${prettyDay(days[0])} to ${prettyDay(days[6])}`}
      action={
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setStart(addDay(start, -7))} aria-label="Previous week"><ChevronLeft size={16} /></Button>
          <Button variant="ghost" size="sm" onClick={() => setStart(weekStart(today()))}>This week</Button>
          <Button variant="ghost" size="sm" onClick={() => setStart(addDay(start, 7))} aria-label="Next week"><ChevronRight size={16} /></Button>
        </div>
      }
    >
      <div className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-10 md:px-10">
        <div className="grid min-w-[840px] grid-cols-7 gap-px overflow-hidden rounded-2xl border border-border bg-border">
          {days.map((d) => {
            const list = sessions.filter((s) => s.date === d);
            const total = list.reduce((a, s) => a + s.plannedMins, 0);
            const examsToday = exams.filter((e) => e.date === d);
            const isToday = d === t;
            return (
              <div key={d} className="min-h-40 bg-surface p-2.5">
                <p className="text-[13px] font-semibold">
                  <span className={cn(isToday && "mark")}>{prettyDay(d)}</span>
                </p>
                <p className={cn("mb-2.5 text-xs tabular-nums", total > dailyMinutes ? "text-bad" : "text-muted")}>
                  {fmtMins(total)} of {fmtMins(dailyMinutes)}
                </p>
                <ul className="space-y-1.5">
                  {examsToday.map((e) => (
                    <li key={`e${e.id}`} className="rounded-md border border-text px-1.5 py-1 text-xs font-semibold">
                      {lookup.subjects.get(e.subjectId)?.name ?? "Exam"} exam
                      {e.time && <span className="block font-normal text-muted">{e.time}</span>}
                    </li>
                  ))}
                  {list.map((s) => {
                    const { title, subject } = describeSession(s, lookup);
                    return (
                      <li
                        key={s.id}
                        className={cn("border-l-2 py-0.5 pl-2 text-xs leading-snug", s.done && "text-muted line-through")}
                        style={{ borderColor: subject?.color ?? "var(--muted)" }}
                        title={title}
                      >
                        <span className="line-clamp-2">{title}</span>
                        <span className="text-muted">{fmtMins(s.plannedMins)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}
