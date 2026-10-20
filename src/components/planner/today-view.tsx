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
    <li className={cn("px-4 py-4 sm:px-6", s.done && "bg-surface-2/50")}>
      <div className="flex items-center gap-3 sm:gap-4">
        <div>
          <Tick
            done={s.done}
            label={s.done ? "Undo, mark not done" : "Mark done"}
            onClick={() => {
              if (s.done) undoSession(s);
              else { setMins(String(s.actualMins || s.plannedMins)); setFinishing(true); }
            }}
          />
        </div>
        <span className="h-10 w-1 shrink-0 rounded-full" style={{ background: subject?.color ?? "var(--muted)" }} />
        <div className="min-w-0 flex-1">
          <p className={cn("text-[15px] leading-snug", s.done ? "text-muted line-through" : "font-semibold")}>{title}</p>
          <p className="mt-0.5 flex min-w-0 items-center gap-2 text-[13px] text-muted">
            <span className="truncate">{sub}</span>
            {s.kind === "revision" && <span className="shrink-0 rounded-md bg-mark-soft px-1.5 py-px text-[11px] font-semibold text-warn">Revision</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="mr-1 text-[13px] tabular-nums text-muted">
            {s.actualMins > 0 ? `${fmtMins(s.actualMins)} of ${fmtMins(s.plannedMins)}` : fmtMins(s.plannedMins)}
          </span>
          {s.done ? (
            <Button variant="ghost" size="sm" onClick={() => undoSession(s)} aria-label="Undo">
              <Undo2 size={16} />
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => onStart(s, title)} aria-label="Start Pomodoro">
              <Play size={15} /> <span className="hidden sm:inline">Focus</span>
            </Button>
          )}
        </div>
      </div>
      {finishing && !s.done && (
        <form
          className="ml-[52px] mt-3 flex flex-wrap items-center gap-2 sm:ml-[60px]"
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

export function TodayView({ sessions, lookup, dailyMinutes, onStart }: {
  sessions: StudySession[];
  lookup: Lookup;
  dailyMinutes: number;
  onStart: (s: StudySession, label: string) => void;
}) {
  const planned = sessions.reduce((a, s) => a + s.plannedMins, 0);
  const done = sessions.filter((s) => s.done).reduce((a, s) => a + s.actualMins, 0);
  if (!sessions.length) return <Empty title="Nothing planned for today">Generate a plan, or take the day off.</Empty>;
  const pct = planned ? Math.round((done / planned) * 100) : 0;
  const count = sessions.filter((s) => s.done).length;
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_1px_3px_rgb(17_24_39/0.04)]">
      <div className="p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Today</h2>
            <p className="text-sm tabular-nums text-muted">
              {count} of {sessions.length} done, {fmtMins(done)} of {fmtMins(planned)}, daily cap {fmtMins(dailyMinutes)}
            </p>
          </div>
          <span className="text-2xl font-bold tabular-nums text-accent">{pct}%</span>
        </div>
        <Progress value={pct} className="mt-4" />
      </div>
      <List className="border-b-0">
        {sessions.map((s) => <SessionRow key={s.id} s={s} lookup={lookup} onStart={onStart} />)}
      </List>
    </section>
  );
}
