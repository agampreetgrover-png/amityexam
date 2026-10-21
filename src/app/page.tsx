"use client";

import Link from "next/link";
import { format } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { BarChart3, ChevronRight, Play, RefreshCw, RotateCcw, Search, Settings as SettingsIcon } from "lucide-react";
import { useState } from "react";
import { db, getSettings } from "@/lib/db";
import { daysBetween, fromDay, prettyDay, today } from "@/lib/dates";
import { examTypeLabel } from "@/lib/exams";
import { examInMode, modeShort, topicsInScope, useExamMode } from "@/lib/mode";
import { examSyllabus } from "@/lib/planner";
import { replan } from "@/lib/replan";
import { coverage, fmtMins } from "@/lib/stats";
import type { StudySession } from "@/lib/types";
import { completeSession, undoSession } from "@/components/planner/actions";
import { Pomodoro } from "@/components/planner/pomodoro";
import { openCommandPalette } from "@/components/command-palette-loader";
import { ModePill } from "@/components/mode-pill";
import { toast } from "@/components/toast";
import { Button, Progress, Tick, cn } from "@/components/ui";

const daysWord = (d: number) => (d === 0 ? "today" : d === 1 ? "day to go" : "days to go");

export default function TodayPage() {
  const t = today();
  const data = useLiveQuery(async () => {
    const [subjects, topics, units, exams, sessions, examCount, settings] = await Promise.all([
      db.subjects.toArray(),
      db.topics.toArray(),
      db.units.toArray(),
      db.exams.where("date").aboveOrEqual(t).sortBy("date"),
      db.sessions.toArray(),
      db.exams.count(),
      getSettings(),
    ]);
    return { subjects, topics, units, exams, sessions, examCount, settings };
  }, [t]);
  const mode = useExamMode();
  const [busy, setBusy] = useState(false);
  const [pickedExam, setPickedExam] = useState<number | null>(null);
  const [timer, setTimer] = useState<{ id: number; label: string } | null>(null);
  if (!data) return null;

  const { subjects, topics, units, exams, sessions, examCount } = data;
  // Everything on this page follows the chosen exam mode and its own syllabus.
  const scoped = topicsInScope(topics, units, mode);
  const modeName = mode === "mid-term" ? "mid-sem" : mode === "end-term" ? "major" : "";
  const subject = (id?: number) => subjects.find((s) => s.id === id);
  const topic = (id?: number) => topics.find((x) => x.id === id);

  const todays = sessions.filter((s) => s.date === t);
  const todaysDone = todays.filter((s) => s.done).length;
  const missed = sessions.filter((s) => s.date < t && !s.done).length;
  const doneMins = todays.filter((s) => s.done).reduce((a, s) => a + s.actualMins, 0);
  const planned = todays.reduce((a, s) => a + s.plannedMins, 0);
  // Same rule as the Revise page: due by schedule, or studied and never revised.
  const topicsDue = scoped.filter((x) => (x.nextReview ? x.nextReview <= t : x.status === "studied")).length;

  const steps = [
    { done: subjects.length > 0, label: "Add your subjects", href: "/subjects" },
    {
      done: scoped.length > 0,
      label: `Import your ${modeName ? `${modeName} ` : ""}syllabus (AI reads it from a PDF)`,
      href: subjects[0] ? `/subjects/${subjects[0].id}` : "/subjects",
    },
    { done: examCount > 0, label: "Add your exam date sheet", href: "/exams" },
    { done: sessions.length > 0, label: "Generate your study plan", href: "/planner" },
  ];
  const onboarding = steps.some((s) => !s.done);

  const modeExams = exams.filter((e) => examInMode(e, mode));
  const shown = modeExams.find((e) => e.id === pickedExam) ?? modeExams[0];
  const shownSubject = subject(shown?.subjectId);
  const shownDays = shown ? daysBetween(t, shown.date) : 0;
  const shownCoverage = shown ? coverage(examSyllabus(shown, topics, units, mode)) : 0;

  const sessionSubject = (s: StudySession) => subject(topic(s.topicId)?.subjectId ?? exams.find((e) => e.id === s.examId)?.subjectId);
  const label = (s: StudySession) =>
    s.kind === "revision" ? `Revise for ${sessionSubject(s)?.name ?? "exam"}` : topic(s.topicId)?.title ?? "Topic";

  const toggle = async (s: StudySession) => {
    if (s.done) {
      await undoSession(s);
      return;
    }
    const token = await completeSession(s, s.actualMins || s.plannedMins);
    toast(`Done: ${label(s)}`, { label: "Undo", onClick: () => void undoSession(s, token) });
  };

  const rebalance = async () => {
    setBusy(true);
    try {
      const res = await replan();
      toast(`Plan rebalanced: ${res.sessions.length} sessions scheduled`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not rebalance the plan");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight md:text-[34px]">
            {mode === "mid-term" ? "Mid-sem Dashboard" : mode === "end-term" ? "Major Exam Dashboard" : "Study Dashboard"}
          </h1>
          <p className="mt-1 text-[15px] text-muted">{format(fromDay(t), "EEEE, d MMMM")}</p>
          <ModePill className="mt-3 md:hidden" />
        </div>
        <div className="-mr-2 flex shrink-0 md:hidden">
          <button type="button" onClick={openCommandPalette} className="rounded-lg p-2 text-muted hover:bg-surface-2" aria-label="Search">
            <Search size={20} />
          </button>
          <Link href="/progress" className="rounded-lg p-2 text-muted hover:bg-surface-2" aria-label="Progress"><BarChart3 size={20} /></Link>
          <Link href="/settings" className="rounded-lg p-2 text-muted hover:bg-surface-2" aria-label="Settings"><SettingsIcon size={20} /></Link>
        </div>
      </header>

      {/* The countdown. Chips switch which exam it counts down to. */}
      <section aria-label="Upcoming exams" className="rounded-2xl border border-border bg-surface p-5 shadow-[0_1px_3px_rgb(17_24_39/0.04)] sm:p-7">
        {shown ? (
          <>
            {modeExams.length > 1 && (
              <div role="tablist" aria-label="Choose an exam" className="-mx-1 mb-6 flex gap-2 overflow-x-auto px-1 pb-1">
                {modeExams.slice(0, 8).map((e) => {
                  const s = subject(e.subjectId);
                  const d = daysBetween(t, e.date);
                  const on = e.id === shown.id;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => setPickedExam(e.id!)}
                      className={cn(
                        "flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] transition-colors",
                        on ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-text/80 hover:border-accent/40 hover:text-text",
                      )}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: s?.color }} />
                      <span className="max-w-40 truncate">{s?.code || s?.name}</span>
                      <span className={cn("tabular-nums", on ? "text-accent/80" : "text-muted")}>{d}d</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex flex-col gap-6 sm:flex-row sm:items-end">
              <div key={shown.id} className="count-in flex shrink-0 items-end gap-3">
                <span className={cn("numeral text-[96px] md:text-[120px]", shownDays <= 3 && "mark")}>{shownDays}</span>
                <span className="pb-2 text-[15px] text-muted">{daysWord(shownDays)}</span>
              </div>
              <div className="min-w-0 flex-1 sm:pb-2">
                <p className="text-xl font-bold leading-snug tracking-tight md:text-2xl">{shownSubject?.name ?? "Exam"}</p>
                <p className="mt-1 text-sm text-muted">
                  {examTypeLabel(shown.type)}, {prettyDay(shown.date)}{shown.time && ` at ${shown.time}`}{shown.venue && `, ${shown.venue}`}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
                  <div className="flex min-w-48 flex-1 items-center gap-3">
                    <Progress value={shownCoverage} className="max-w-56" />
                    <span className="whitespace-nowrap text-[13px] text-muted"><strong className="font-semibold text-text">{shownCoverage}%</strong> covered</span>
                  </div>
                  <Link
                    href={`/exams/${shown.id}`}
                    className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm font-medium hover:bg-surface-2"
                  >
                    Exam kit <ChevronRight size={16} className="-mr-1 text-muted" />
                  </Link>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div>
            <p className="text-xl font-bold tracking-tight">No {mode ? `${modeShort(mode).toLowerCase()} ` : ""}exams coming up</p>
            <p className="mt-1 text-[15px] text-muted">
              {examCount ? "Nothing upcoming in this exam mode. Add the next date sheet when it's out." : "Add your date sheet and the countdown starts here."}
            </p>
            <Link href="/exams" className="mt-4 inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-ink hover:opacity-90">
              Add exams
            </Link>
          </div>
        )}
      </section>

      {onboarding && (
        <section aria-label="Get set up" className="rounded-2xl border border-dashed border-border px-5 py-4">
          <p className="mb-3 text-[15px] font-semibold">Get set up</p>
          <ol className="grid gap-2 sm:grid-cols-2">
            {steps.map((s, i) => (
              <li key={i}>
                <Link href={s.href} className="flex items-center gap-3 rounded-lg px-1 py-1.5 text-[15px] hover:bg-surface-2/70">
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                      s.done ? "bg-good text-white" : "border border-border text-muted",
                    )}
                  >
                    {s.done ? "✓" : i + 1}
                  </span>
                  <span className={s.done ? "text-muted line-through" : "font-medium"}>{s.label}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Today's plan: tick to finish, Start to run the focus timer. */}
      <section aria-labelledby="plan-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <h2 id="plan-heading" className="text-lg font-semibold">Today&apos;s plan</h2>
          {todays.length > 0 && (
            <p className="text-sm tabular-nums text-muted">
              <strong className="font-semibold text-text">{todaysDone} of {todays.length}</strong> done, {fmtMins(doneMins)} of {fmtMins(planned)}
            </p>
          )}
        </div>
        {todays.length > 0 && (
          <div className="mb-3 flex gap-1" aria-hidden>
            {todays.map((s) => (
              <span key={s.id} className={cn("h-1.5 flex-1 rounded-full transition-colors duration-300", s.done ? "bg-accent" : "bg-border")} />
            ))}
          </div>
        )}
        {todays.length === 0 ? (
          <p className="rounded-2xl border border-border bg-surface px-5 py-5 text-[15px] text-muted">
            {sessions.length ? "Nothing scheduled today. Rest, or get ahead on revision." : <>No plan yet. <Link href="/planner" className="font-medium text-accent underline underline-offset-2">Open the planner</Link> to build one.</>}
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_1px_3px_rgb(17_24_39/0.04)]">
            {todays.map((s) => {
              const sub = sessionSubject(s);
              return (
                <li key={s.id} className={cn("flex items-center gap-4 px-4 py-3.5 transition-colors sm:px-5", s.done && "bg-surface-2/50")}>
                  <Tick done={s.done} label={s.done ? `Mark ${label(s)} not done` : `Mark ${label(s)} done`} onClick={() => toggle(s)} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-[15px] transition-colors", s.done ? "text-muted line-through" : "font-semibold")}>{label(s)}</p>
                    <p className="flex items-center gap-1.5 truncate text-[13px] text-muted">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: sub?.color }} />
                      <span className="truncate">{sub?.name}</span>
                      {s.kind === "revision" && <span className="shrink-0 text-warn">revision</span>}
                    </p>
                  </div>
                  <span className="text-[13px] tabular-nums text-muted">{fmtMins(s.plannedMins)}</span>
                  {!s.done && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => s.id != null && setTimer({ id: s.id, label: label(s) })}
                      aria-label={`Start focus timer for ${label(s)}`}
                    >
                      <Play size={14} /> <span className="hidden sm:inline">Start</span>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Two quiet nudges, only when there's something to do. */}
      {(missed > 0 || topicsDue > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {missed > 0 && (
            <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-mark-soft px-4 py-3">
              <p className="min-w-0 flex-1 text-[15px]">
                <strong className="font-semibold">{missed} missed session{missed > 1 ? "s" : ""}</strong>
                <span className="block text-[13px] text-muted">Spread {missed > 1 ? "them" : "it"} over the days ahead</span>
              </p>
              <Button size="sm" disabled={busy} onClick={rebalance}>
                <RefreshCw size={14} className={cn(busy && "animate-spin")} /> {busy ? "Rebalancing" : "Rebalance"}
              </Button>
            </div>
          )}
          {topicsDue > 0 && (
            <Link href="/revise" className="group flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 hover:border-accent/40">
              <RotateCcw size={18} className="shrink-0 text-accent" />
              <p className="min-w-0 flex-1 text-[15px]">
                <strong className="font-semibold">{topicsDue} topic{topicsDue === 1 ? "" : "s"} to revise</strong>
                <span className="block text-[13px] text-muted">Spaced revision keeps them fresh</span>
              </p>
              <span className="text-sm font-medium text-accent group-hover:underline group-hover:underline-offset-2">Start</span>
            </Link>
          )}
        </div>
      )}

      <Pomodoro sessionId={timer?.id ?? null} label={timer?.label ?? ""} onClose={() => setTimer(null)} />
    </div>
  );
}
