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
      href: subjects[0] ? `/subjects/view?id=${subjects[0].id}` : "/subjects",
    },
    { done: examCount > 0, label: "Add your exam date sheet", href: "/exams" },
    { done: sessions.length > 0, label: "Generate your study plan", href: "/planner" },
  ];
  const onboarding = steps.some((s) => !s.done);

  const modeExams = exams.filter((e) => examInMode(e, mode));
  const shown = modeExams.find((e) => e.id === pickedExam) ?? modeExams[0];
  const shownSubject = subject(shown?.subjectId);
  const shownDays = shown ? daysBetween(t, shown.date) : 0;
  const examCoverage = (e: (typeof exams)[number]) => coverage(examSyllabus(e, topics, units, mode));
  const shownCoverage = shown ? examCoverage(shown) : 0;

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
    <div className="space-y-10">
      <header className="flex items-start justify-between gap-4 border-b border-border pb-5">
        <div className="min-w-0">
          <p className="text-sm text-muted">{format(fromDay(t), "EEEE, d MMMM")}</p>
          <h1 className="mt-1 font-display text-[28px] leading-tight md:text-[32px]">
            {mode === "mid-term" ? "Mid-sem Dashboard" : mode === "end-term" ? "Major Exam Dashboard" : "Study Dashboard"}
          </h1>
          <ModePill className="mt-3 md:hidden" />
        </div>
        <div className="-mr-2 flex shrink-0 md:hidden">
          <button type="button" onClick={openCommandPalette} className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-text" aria-label="Search">
            <Search size={20} />
          </button>
          <Link href="/progress" className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-text" aria-label="Progress"><BarChart3 size={20} /></Link>
          <Link href="/settings" className="rounded-md p-2 text-muted hover:bg-surface-2 hover:text-text" aria-label="Settings"><SettingsIcon size={20} /></Link>
        </div>
      </header>

      {/* The date sheet: the chosen exam counted down in large figures, every upcoming exam of this mode listed beneath.
          Picking a row switches which exam the countdown follows. */}
      <section aria-labelledby="exams-heading">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="exams-heading" className="text-[15px] font-semibold">Upcoming exams</h2>
          <Link href="/exams" className="text-sm font-medium text-accent hover:underline">All exams</Link>
        </div>
        {shown ? (
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="grid gap-x-8 gap-y-5 p-5 sm:grid-cols-[auto_1fr] sm:items-end sm:p-6">
              <div key={shown.id} className="count-in flex items-end gap-3">
                <span className="numeral text-[88px] md:text-[104px]">
                  <span className={cn(shownDays <= 3 && "mark")}>{shownDays}</span>
                </span>
                <span className="pb-1.5 text-sm text-muted">{daysWord(shownDays)}</span>
              </div>
              <div className="min-w-0 sm:pb-1.5">
                <p className="flex items-center gap-2 text-xl font-semibold leading-snug">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: shownSubject?.color }} />
                  <span className="min-w-0">{shownSubject?.name ?? "Exam"}</span>
                </p>
                <p className="mt-1 text-sm text-muted">
                  {examTypeLabel(shown.type)}, {prettyDay(shown.date)}{shown.time && ` at ${shown.time}`}{shown.venue && `, ${shown.venue}`}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
                  <div className="flex min-w-48 flex-1 items-center gap-3">
                    <Progress value={shownCoverage} className="max-w-56" />
                    <span className="whitespace-nowrap text-[13px] text-muted"><strong className="font-semibold text-text">{shownCoverage}%</strong> of syllabus covered</span>
                  </div>
                  <Link
                    href={`/exams/view?id=${shown.id}`}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-3 text-[13px] font-medium transition-colors hover:bg-surface-2"
                  >
                    Exam kit <ChevronRight size={15} className="-mr-1 text-muted" />
                  </Link>
                </div>
              </div>
            </div>
            {modeExams.length > 1 && (
              <div role="tablist" aria-label="Choose an exam" className="divide-y divide-border border-t border-border">
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
                        "grid w-full grid-cols-[3rem_1fr_auto] items-center gap-x-4 border-l-2 px-5 py-2.5 text-left transition-colors sm:grid-cols-[3rem_1fr_9rem_4rem] sm:px-6",
                        on ? "border-accent bg-accent-soft" : "border-transparent hover:bg-surface-2",
                      )}
                    >
                      <span className="numeral text-[26px]"><span className={cn(d <= 3 && "mark")}>{d}</span></span>
                      <span className="min-w-0">
                        <span className={cn("flex items-center gap-2 truncate text-sm", on ? "font-semibold text-accent" : "font-medium")}>
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s?.color }} />
                          <span className="truncate">{s?.name}</span>
                        </span>
                        <span className="block truncate text-[13px] text-muted">{s?.code ? `${s.code}, ` : ""}{examTypeLabel(e.type)}</span>
                      </span>
                      <span className="hidden text-[13px] tabular-nums text-muted sm:block">{prettyDay(e.date)}{e.time && `, ${e.time}`}</span>
                      <span className="text-right text-[13px] tabular-nums text-muted">{examCoverage(e)}%</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-[#cfd4dc] px-5 py-6">
            <p className="font-semibold">No {mode ? `${modeShort(mode).toLowerCase()} ` : ""}exams coming up</p>
            <p className="mt-1 text-sm text-muted">
              {examCount ? "Nothing upcoming in this exam mode. Add the next date sheet when it's out." : "Add your date sheet and the countdown starts here."}
            </p>
            <Link href="/exams" className="mt-4 inline-flex h-9 items-center rounded-md bg-accent px-3.5 text-sm font-medium text-accent-ink hover:bg-[#15306a]">
              Add exams
            </Link>
          </div>
        )}
      </section>

      {onboarding && (
        <section aria-label="Get set up" className="rounded-lg border border-border bg-surface-2 px-5 py-4">
          <p className="mb-2 text-[15px] font-semibold">Get set up</p>
          <ol className="grid gap-1 sm:grid-cols-2">
            {steps.map((s, i) => (
              <li key={i}>
                <Link href={s.href} className="flex items-center gap-3 rounded-md px-1.5 py-1.5 text-sm hover:bg-surface-3/70">
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                      s.done ? "bg-good text-white" : "border border-[#b9bfca] text-muted",
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
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="plan-heading" className="text-[15px] font-semibold">Today&apos;s plan</h2>
          {todays.length > 0 && (
            <p className="text-sm tabular-nums text-muted">
              <strong className="font-semibold text-text">{todaysDone} of {todays.length}</strong> done, {fmtMins(doneMins)} of {fmtMins(planned)}
            </p>
          )}
        </div>
        {todays.length > 0 && (
          <div className="mb-3 flex gap-1" aria-hidden>
            {todays.map((s) => (
              <span key={s.id} className={cn("h-1 flex-1 rounded-full transition-colors duration-300", s.done ? "bg-accent" : "bg-surface-3")} />
            ))}
          </div>
        )}
        {todays.length === 0 ? (
          <p className="rounded-lg border border-border px-5 py-4 text-sm text-muted">
            {sessions.length ? "Nothing scheduled today. Rest, or get ahead on revision." : <>No plan yet. <Link href="/planner" className="font-medium text-accent underline underline-offset-2">Open the planner</Link> to build one.</>}
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {todays.map((s) => {
              const sub = sessionSubject(s);
              return (
                <li key={s.id} className={cn("flex items-center gap-4 px-4 py-3 transition-colors sm:px-5", s.done && "bg-surface-2")}>
                  <Tick done={s.done} label={s.done ? `Mark ${label(s)} not done` : `Mark ${label(s)} done`} onClick={() => toggle(s)} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-[15px]", s.done ? "text-muted line-through" : "font-medium")}>{label(s)}</p>
                    <p className="flex items-center gap-1.5 truncate text-[13px] text-muted">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: sub?.color }} />
                      <span className="truncate">{sub?.name}</span>
                      {s.kind === "revision" && <span className="shrink-0 rounded bg-mark-soft px-1.5 text-[11px] font-medium text-warn">revision</span>}
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
            <div className="flex items-center gap-3 rounded-lg border border-mark/40 bg-mark-soft px-4 py-3">
              <p className="min-w-0 flex-1 text-sm">
                <strong className="font-semibold">{missed} missed session{missed > 1 ? "s" : ""}</strong>
                <span className="block text-[13px] text-muted">Spread {missed > 1 ? "them" : "it"} over the days ahead</span>
              </p>
              <Button size="sm" disabled={busy} onClick={rebalance}>
                <RefreshCw size={14} className={cn(busy && "animate-spin")} /> {busy ? "Rebalancing" : "Rebalance"}
              </Button>
            </div>
          )}
          {topicsDue > 0 && (
            <Link href="/revise" className="group flex items-center gap-3 rounded-lg border border-border px-4 py-3 transition-colors hover:bg-surface-2">
              <RotateCcw size={17} className="shrink-0 text-muted" />
              <p className="min-w-0 flex-1 text-sm">
                <strong className="font-semibold">{topicsDue} topic{topicsDue === 1 ? "" : "s"} to revise</strong>
                <span className="block text-[13px] text-muted">Spaced revision keeps them fresh</span>
              </p>
              <span className="text-sm font-medium text-accent group-hover:underline">Start</span>
            </Link>
          )}
        </div>
      )}

      <Pomodoro sessionId={timer?.id ?? null} label={timer?.label ?? ""} onClose={() => setTimer(null)} />
    </div>
  );
}
