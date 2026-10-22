"use client";

import { Play, Undo2 } from "lucide-react";
import { useState } from "react";
import { Button, Empty, Input, List, Progress, Tick, cn } from "@/components/ui";
import { fmtMins } from "@/lib/stats";
import type { StudySession } from "@/lib/types";
import { completeSession, undoSession } from "./actions";
import { describeSession, type Lookup } from "./lookup";

function SessionRow({ s, lookup, onStart }: { s: StudySession; lookup: Lookup; onStart: (s: StudySession, label: string) => void }) {
  const { title, sub, subject } = describeSession(s, lookup);
  // While completing, let the user correct actual minutes (prefilled from Pomodoro or plan).
  const [finishing, setFinishing] = useState(false);
  const [mins, setMins] = useState(String(s.actualMins || s.plannedMins));

  return (
    <li className="py-3 pl-1 pr-1 transition-colors duration-150 hover:bg-surface-2 sm:pl-2 sm:pr-2">
      <div className="flex items-center gap-3">
        <Tick
          done={s.done}
          label={s.done ? "Undo, mark not done" : "Mark done"}
          onClick={() => {
            if (s.done) undoSession(s);
            else { setMins(String(s.actualMins || s.plannedMins)); setFinishing(true); }
          }}
        />
        {/* Subject colour as a thin rule at the start of the row. */}
        <span
          aria-hidden
          className={cn("h-9 w-[3px] shrink-0 rounded-sm", s.done && "opacity-40")}
          style={{ background: subject?.color ?? "var(--muted)" }}
        />
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-[15px] leading-snug", s.done ? "text-muted line-through decoration-muted/60" : "font-medium")}>{title}</p>
          <p className="mt-0.5 flex min-w-0 items-center gap-2 text-[13px] text-muted">
            <span className="truncate">{sub}</span>
            {s.kind === "revision" && (
              <span className="shrink-0 rounded bg-mark-soft px-1.5 py-px text-xs font-medium text-warn">Revision</span>
            )}
          </p>
        </div>
        <span className="shrink-0 text-right text-[13px] tabular-nums text-muted">
          {s.actualMins > 0 ? `${fmtMins(s.actualMins)} of ${fmtMins(s.plannedMins)}` : fmtMins(s.plannedMins)}
        </span>
        <div className="flex shrink-0 justify-end sm:w-[84px]">
          {s.done ? (
            <Button variant="ghost" size="sm" onClick={() => undoSession(s)} aria-label="Undo">
              <Undo2 size={16} />
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => onStart(s, title)} aria-label={`Start focus timer for ${title}`}>
              <Play size={14} /> <span className="hidden sm:inline">Start</span>
            </Button>
          )}
        </div>
      </div>
      {finishing && !s.done && (
        <form
          className="ml-[46px] mt-3 flex flex-wrap items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await completeSession(s, Number(mins) || 0);
            setFinishing(false);
          }}
        >
          <label className="flex items-center gap-2 text-sm text-muted">
            Minutes studied
            <Input type="number" min={0} value={mins} onChange={(e) => setMins(e.target.value)} className="h-8 w-20" autoFocus />
          </label>
          <Button size="sm" type="submit">Save</Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setFinishing(false)}>Cancel</Button>
        </form>
      )}
    </li>
  );
}

export function TodayView({ sessions, hasPlan, lookup, dailyMinutes, onStart }: {
  sessions: StudySession[];
  /** Whether any sessions exist on any day; decides between "make a plan" and "a free day". */
  hasPlan: boolean;
  lookup: Lookup;
  dailyMinutes: number;
  onStart: (s: StudySession, label: string) => void;
}) {
  if (!sessions.length) {
    return (
      <Empty title="Nothing planned for today">
        {hasPlan ? "Today is free in your plan. Rest, or get ahead on revision." : "Generate a plan, or take the day off."}
      </Empty>
    );
  }
  const planned = sessions.reduce((a, s) => a + s.plannedMins, 0);
  const done = sessions.filter((s) => s.done).reduce((a, s) => a + s.actualMins, 0);
  // Extra minutes on one session (a long focus sitting) mustn't push today past 100%.
  const doneCapped = sessions.filter((s) => s.done).reduce((a, s) => a + Math.min(s.actualMins, s.plannedMins), 0);
  const pct = planned ? Math.min(100, Math.round((doneCapped / planned) * 100)) : 0;
  const count = sessions.filter((s) => s.done).length;
  return (
    <section>
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">Today</h2>
          <p className="mt-1 text-[13px] tabular-nums text-muted">
            {count} of {sessions.length} done, {fmtMins(done)} of {fmtMins(planned)}, daily cap {fmtMins(dailyMinutes)}
          </p>
        </div>
        <p className={cn("numeral shrink-0 text-[40px]", pct >= 100 && "text-good")}>
          {pct}<span className="text-[24px] text-muted">%</span>
        </p>
      </div>
      <Progress value={pct} className="mb-4 mt-3" />
      <List>
        {sessions.map((s) => <SessionRow key={s.id} s={s} lookup={lookup} onStart={onStart} />)}
      </List>
    </section>
  );
}
