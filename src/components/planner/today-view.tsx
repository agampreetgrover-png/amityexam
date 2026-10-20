"use client";

import { Play, Undo2 } from "lucide-react";
import { useState } from "react";
import { Button, Empty, Input, List, Progress, Section, Tick, cn } from "@/components/ui";
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
    <li className="py-3">
      <div className="flex items-start gap-3">
        <div className="pt-0.5">
          <Tick
            done={s.done}
            label={s.done ? "Undo, mark not done" : "Mark done"}
            onClick={() => {
              if (s.done) undoSession(s);
              else { setMins(String(s.actualMins || s.plannedMins)); setFinishing(true); }
            }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn("font-medium leading-snug", s.done && "text-muted line-through")}>{title}</p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: subject?.color ?? "var(--muted)" }} />
            <span className="truncate">{sub}</span>
            {s.kind === "revision" && <span className="shrink-0 text-warn">Revision</span>}
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
          className="ml-[34px] mt-3 flex flex-wrap items-center gap-2"
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
  return (
    <Section
      title="Today"
      action={<span className="text-[13px] tabular-nums text-muted">{fmtMins(done)} of {fmtMins(planned)}, daily cap {fmtMins(dailyMinutes)}</span>}
    >
      <Progress value={planned ? (done / planned) * 100 : 0} className="mb-4" />
      <List>
        {sessions.map((s) => <SessionRow key={s.id} s={s} lookup={lookup} onStart={onStart} />)}
      </List>
    </Section>
  );
}
