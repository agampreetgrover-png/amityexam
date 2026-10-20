"use client";

import Link from "next/link";
import { format } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { BarChart3, BookOpen, CalendarDays, ChevronRight, Clock, Settings as SettingsIcon, Target, TrendingUp } from "lucide-react";
import { useState } from "react";
import { db, getSettings } from "@/lib/db";
import { daysBetween, fromDay, prettyDay, today } from "@/lib/dates";
import { examTypeLabel } from "@/lib/exams";
import { replan } from "@/lib/replan";
import { coverage, fmtMins } from "@/lib/stats";
import { completeSession, undoSession } from "@/components/planner/actions";
import { StatTile } from "@/components/progress/stat-tile";
import { Button, Card, List, Progress, Tick, cn } from "@/components/ui";

export default function TodayPage() {
  const t = today();
  const data = useLiveQuery(async () => {
    const [subjects, topics, exams, sessions, cardsDue, examCount, settings] = await Promise.all([
      db.subjects.toArray(),
      db.topics.toArray(),
      db.exams.where("date").aboveOrEqual(t).sortBy("date"),
      db.sessions.toArray(),
      db.flashcards.where("due").belowOrEqual(t).count(),
      db.exams.count(),
      getSettings(),
    ]);
    return { subjects, topics, exams, sessions, cardsDue, examCount, settings };
  }, [t]);
  const [busy, setBusy] = useState(false);
  if (!data) return null;

  const { subjects, topics, exams, sessions, cardsDue, examCount } = data;
  const subject = (id?: number) => subjects.find((s) => s.id === id);
  const topic = (id?: number) => topics.find((x) => x.id === id);
  const todays = sessions.filter((s) => s.date === t);
  const todaysDone = todays.filter((s) => s.done).length;
  const missed = sessions.filter((s) => s.date < t && !s.done).length;
  const doneMins = todays.filter((s) => s.done).reduce((a, s) => a + s.actualMins, 0);
  const planned = todays.reduce((a, s) => a + s.plannedMins, 0);
  const pct = planned ? Math.round((doneMins / planned) * 100) : 0;
  const topicsDue = topics.filter((x) => x.nextReview && x.nextReview <= t).length;

  const steps = [
    { done: subjects.length > 0, label: "Add your subjects", href: "/subjects" },
    { done: topics.length > 0, label: "Import each syllabus (AI reads it from a PDF)", href: subjects[0] ? `/subjects/${subjects[0].id}` : "/subjects" },
    { done: examCount > 0, label: "Add your exam date sheet", href: "/exams" },
    { done: sessions.length > 0, label: "Generate your study plan", href: "/planner" },
    { done: data.settings.notifications, label: "Turn on reminders", href: "/settings" },
  ];
  const onboarding = steps.slice(0, 4).some((s) => !s.done);

  const [next, ...later] = exams;
  const nextSubject = subject(next?.subjectId);
  const nextDays = next ? daysBetween(t, next.date) : 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4 pb-2">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight md:text-[34px]">Study Dashboard</h1>
          <p className="mt-1 text-[15px] text-muted">{format(fromDay(t), "EEEE, MMMM d")}</p>
        </div>
        <div className="-mr-2 flex md:hidden">
          <Link href="/progress" className="rounded-lg p-2 text-muted hover:bg-surface-2" aria-label="Progress"><BarChart3 size={20} /></Link>
          <Link href="/settings" className="rounded-lg p-2 text-muted hover:bg-surface-2" aria-label="Settings"><SettingsIcon size={20} /></Link>
        </div>
        <div className="hidden gap-3 md:flex">
          <Link href="/subjects" className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm font-medium hover:bg-surface-2">
            <BookOpen size={17} /> Subjects
          </Link>
          <Link href="/planner" className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink hover:opacity-90">
            <CalendarDays size={17} /> Open planner
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile tone="indigo" icon={<Clock />} label="Studied today" value={fmtMins(doneMins)} sub={planned ? `of ${fmtMins(planned)} planned` : "nothing planned"} />
        <StatTile tone="emerald" icon={<TrendingUp />} label="Syllabus covered" value={`${coverage(topics)}%`} sub={`across ${topics.length} topic${topics.length === 1 ? "" : "s"}`} />
        <StatTile tone="violet" icon={<Target />} label="Today's progress" value={`${todaysDone}/${todays.length}`} sub="sessions done" />
        <StatTile tone="amber" icon={<BookOpen />} label="Subjects" value={subjects.length} sub={`${topics.length} topics total`} />
      </div>

      {missed > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-amber-200 bg-mark-soft px-5 py-3.5 text-[15px]">
          <span className="flex-1">
            <strong className="font-semibold">{missed} missed session{missed > 1 ? "s" : ""}.</strong> Rebalance to spread {missed > 1 ? "them" : "it"} over the days ahead.
          </span>
          <Button size="sm" disabled={busy} onClick={async () => { setBusy(true); try { await replan(); } finally { setBusy(false); } }}>
            {busy ? "Rebalancing…" : "Rebalance"}
          </Button>
        </div>
      )}

      {onboarding && (
        <Card title="Get set up">
          <List className="border-y-0">
            {steps.map((s, i) => (
              <li key={i}>
                <Link href={s.href} className="flex items-center gap-3 py-3 text-[15px] hover:bg-surface-2/60">
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
          </List>
        </Card>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Today's plan */}
        <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_1px_3px_rgb(17_24_39/0.04)]">
          <div className="p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Today&apos;s plan</h2>
                <p className="text-sm text-muted">
                  {todays.length ? `${todaysDone} of ${todays.length} sessions completed` : "No sessions today"}
                </p>
              </div>
              {todays.length > 0 && <span className="text-2xl font-bold tabular-nums text-accent">{pct}%</span>}
            </div>
            {todays.length > 0 && <Progress value={pct} className="mt-4" />}
          </div>
          {todays.length === 0 ? (
            <p className="border-t border-border px-5 py-5 text-[15px] text-muted sm:px-6">
              {sessions.length ? "Nothing scheduled today. Rest, or get ahead on revision." : <>No plan yet. <Link href="/planner" className="font-medium text-accent underline underline-offset-2">Open the planner</Link> to build one.</>}
            </p>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {todays.map((s) => {
                const tp = topic(s.topicId);
                const ex = exams.find((e) => e.id === s.examId);
                const sub = subject(tp?.subjectId ?? ex?.subjectId);
                return (
                  <li key={s.id} className={cn("flex items-center gap-4 px-5 py-4 sm:px-6", s.done && "bg-surface-2/50")}>
                    <Tick
                      done={s.done}
                      label={s.done ? "Mark not done" : "Mark done"}
                      onClick={() => (s.done ? undoSession(s) : completeSession(s, s.actualMins || s.plannedMins))}
                    />
                    <span className="h-10 w-1 shrink-0 rounded-full" style={{ background: sub?.color }} />
                    <div className="min-w-0 flex-1">
                      <p className={cn("truncate text-[15px]", s.done ? "text-muted line-through" : "font-semibold")}>
                        {s.kind === "revision" ? `Revise for ${sub?.name ?? "exam"}` : tp?.title ?? "Topic"}
                      </p>
                      <p className="truncate text-[13px] text-muted">{sub?.name}</p>
                    </div>
                    <span className="flex items-center gap-1.5 text-[13px] tabular-nums text-muted">
                      <Clock size={15} /> {fmtMins(s.plannedMins)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {todays.length > 0 && (
            <Link href="/planner" className="flex items-center justify-end gap-1 border-t border-border px-5 py-3 text-sm font-medium text-accent hover:bg-surface-2/60 sm:px-6">
              Open planner <ChevronRight size={16} />
            </Link>
          )}
        </section>

        <div className="space-y-6">
          {/* Next exam, as a countdown */}
          {next ? (
            <Card title="Next exam">
              <Link href={`/exams/${next.id}`} className="group block">
                <div className="flex items-end gap-3">
                  <span className={cn("numeral text-[72px]", nextDays <= 3 && "mark")}>{nextDays}</span>
                  <span className="pb-1 text-[15px] leading-tight text-muted">
                    {nextDays === 0 ? "exam today" : nextDays === 1 ? "day left" : "days left"}
                  </span>
                </div>
                <p className="mt-3 flex items-center gap-2 text-lg font-semibold group-hover:underline group-hover:underline-offset-4">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: nextSubject?.color }} />
                  {nextSubject?.name ?? "Exam"}
                </p>
                <p className="mt-0.5 text-sm text-muted">
                  {examTypeLabel(next.type)}, {prettyDay(next.date)}{next.time && ` at ${next.time}`}{next.venue && `, ${next.venue}`}
                </p>
              </Link>
              {later.length > 0 && (
                <ul className="mt-4 space-y-1.5 border-t border-border pt-3 text-sm">
                  {later.slice(0, 4).map((e) => {
                    const s = subject(e.subjectId);
                    return (
                      <li key={e.id}>
                        <Link href={`/exams/${e.id}`} className="flex items-center justify-between gap-3 hover:underline hover:underline-offset-2">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s?.color }} />
                            <span className="truncate">{s?.name}</span>
                          </span>
                          <span className="font-semibold tabular-nums">{daysBetween(t, e.date)}d</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          ) : (
            <Card title="Next exam">
              <p className="font-semibold">No exams on the calendar</p>
              <p className="mt-1 text-sm text-muted">
                {examCount ? "Every exam is behind you. Add the next date sheet when it's out." : "Add your date sheet and the countdown starts here."}
              </p>
            </Card>
          )}

          <Card title="Due to revise">
            <Link href="/revise" className="group flex items-end gap-6">
              <span className="flex flex-col">
                <span className={cn("numeral text-5xl", cardsDue > 0 && "mark self-start")}>{cardsDue}</span>
                <span className="mt-1.5 text-[13px] text-muted">flashcard{cardsDue === 1 ? "" : "s"}</span>
              </span>
              <span className="flex flex-col">
                <span className="numeral text-5xl">{topicsDue}</span>
                <span className="mt-1.5 text-[13px] text-muted">topic{topicsDue === 1 ? "" : "s"}</span>
              </span>
              <span className="mb-6 ml-auto text-sm font-medium text-accent underline-offset-2 group-hover:underline">Start</span>
            </Link>
          </Card>

          <Card title="Syllabus covered">
            {subjects.length === 0 ? (
              <p className="text-[15px] text-muted">No subjects yet.</p>
            ) : (
              <ul className="space-y-4">
                {subjects.map((s) => {
                  const c = coverage(topics.filter((x) => x.subjectId === s.id));
                  return (
                    <li key={s.id}>
                      <Link href={`/subjects/${s.id}`} className="block text-sm hover:underline hover:underline-offset-2">
                        <div className="mb-1.5 flex justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-2 font-medium">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                            <span className="truncate">{s.name}</span>
                          </span>
                          <span className={cn("font-semibold tabular-nums", c < 50 ? "text-warn" : "text-good")}>{c}%</span>
                        </div>
                        <Progress value={c} color={s.color} />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
