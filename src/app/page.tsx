"use client";

import Link from "next/link";
import { format } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { BarChart3, ChevronRight, Search, Settings as SettingsIcon } from "lucide-react";
import { useState } from "react";
import { db } from "@/lib/db";
import { daysBetween, fromDay, prettyDay, today } from "@/lib/dates";
import { examTypeLabel } from "@/lib/exams";
import { examInMode, examSyllabus, modeShort, topicsInScope, useExamMode } from "@/lib/mode";
import { coverage } from "@/lib/stats";
import { openCommandPalette } from "@/components/command-palette-loader";
import { ModePill } from "@/components/mode-pill";
import { Progress, cn, subjectStyle } from "@/components/ui";

const daysWord = (d: number) => (d === 0 ? "today" : d === 1 ? "day to go" : "days to go");

export default function TodayPage() {
  const t = today();
  const data = useLiveQuery(async () => {
    const [subjects, topics, units, exams, examCount] = await Promise.all([
      db.subjects.toArray(),
      db.topics.toArray(),
      db.units.toArray(),
      db.exams.where("date").aboveOrEqual(t).sortBy("date"),
      db.exams.count(),
    ]);
    return { subjects, topics, units, exams, examCount };
  }, [t]);
  const mode = useExamMode();
  const [pickedExam, setPickedExam] = useState<number | null>(null);
  if (!data) return null;

  const { subjects, topics, units, exams, examCount } = data;
  // Everything on this page follows the chosen exam mode and its own syllabus.
  const scoped = topicsInScope(topics, units, mode);
  const modeName = mode === "mid-term" ? "mid-sem" : mode === "end-term" ? "major" : "";
  const subject = (id?: number) => subjects.find((s) => s.id === id);

  const steps = [
    { done: subjects.length > 0, label: "Add your subjects", href: "/subjects" },
    {
      done: scoped.length > 0,
      label: `Import your ${modeName ? `${modeName} ` : ""}syllabus (AI reads it from a PDF)`,
      href: subjects[0] ? `/subjects/view?id=${subjects[0].id}` : "/subjects",
    },
    { done: examCount > 0, label: "Add your exam date sheet", href: "/exams" },
  ];
  const onboarding = steps.some((s) => !s.done);

  const modeExams = exams.filter((e) => examInMode(e, mode));
  const shown = modeExams.find((e) => e.id === pickedExam) ?? modeExams[0];
  const shownSubject = subject(shown?.subjectId);
  const shownDays = shown ? daysBetween(t, shown.date) : 0;
  const examCoverage = (e: (typeof exams)[number]) => coverage(examSyllabus(e, topics, units, mode));
  const shownCoverage = shown ? examCoverage(shown) : 0;

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
            {/* The countdown takes the exam's subject colour: a tinted sheet with that colour's tab down its edge.
                Picking another exam below recolours it. */}
            <div
              key={shown.id}
              style={subjectStyle(shownSubject?.color)}
              className="subj-tint subj-edge-thick count-in grid gap-x-8 gap-y-5 p-5 pl-7 sm:grid-cols-[auto_1fr] sm:items-end sm:p-6 sm:pl-9"
            >
              <div className="flex items-end gap-3">
                <span className="numeral subj-ink text-[88px] md:text-[104px]">
                  <span className={cn(shownDays <= 3 && "mark")}>{shownDays}</span>
                </span>
                <span className="pb-1.5 text-sm font-medium text-muted">{daysWord(shownDays)}</span>
              </div>
              <div className="min-w-0 sm:pb-1.5">
                <p className="text-xl font-semibold leading-snug">{shownSubject?.name ?? "Exam"}</p>
                <p className="mt-1 text-sm text-muted">
                  {examTypeLabel(shown.type)}, {prettyDay(shown.date)}{shown.time && ` at ${shown.time}`}{shown.venue && `, ${shown.venue}`}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
                  <div className="flex min-w-48 flex-1 items-center gap-3">
                    <Progress value={shownCoverage} color={shownSubject?.color} className="max-w-56 bg-surface/90" />
                    <span className="whitespace-nowrap text-[13px] text-muted"><strong className="font-semibold text-text">{shownCoverage}%</strong> of syllabus covered</span>
                  </div>
                  <Link
                    href={`/exams/view?id=${shown.id}`}
                    className="subj-line inline-flex h-8 items-center gap-1 rounded-md border bg-surface px-3 text-[13px] font-medium transition-colors hover:bg-surface-2"
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
                      style={subjectStyle(s?.color)}
                      className={cn(
                        "subj-edge grid w-full grid-cols-[3rem_1fr_auto] items-center gap-x-4 px-5 py-2.5 text-left transition-colors sm:grid-cols-[3rem_1fr_9rem_4rem] sm:px-6",
                        on ? "subj-tint" : "subj-hover",
                      )}
                    >
                      <span className="numeral text-[26px]"><span className={cn(d <= 3 && "mark")}>{d}</span></span>
                      <span className="min-w-0">
                        <span className={cn("block truncate text-sm", on ? "subj-ink font-semibold" : "font-medium")}>{s?.name}</span>
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
          <div className="rounded-lg border border-dashed border-line-strong bg-surface-2 px-5 py-6">
            <p className="font-semibold">No {mode ? `${modeShort(mode).toLowerCase()} ` : ""}exams coming up</p>
            <p className="mt-1 text-sm text-muted">
              {examCount ? "Nothing upcoming in this exam mode. Add the next date sheet when it's out." : "Add your date sheet and the countdown starts here."}
            </p>
            <Link href="/exams" className="mt-4 inline-flex h-9 items-center rounded-md bg-accent px-3.5 text-sm font-medium text-accent-ink hover:bg-accent-hover">
              Add exams
            </Link>
          </div>
        )}
      </section>

      {onboarding && (
        <section aria-label="Get set up" className="rounded-lg border border-accent/15 bg-accent-soft/60 px-5 py-4">
          <p className="mb-2 text-[15px] font-semibold">Get set up</p>
          <ol className="grid gap-1 sm:grid-cols-2">
            {steps.map((s, i) => (
              <li key={i}>
                <Link href={s.href} className="flex items-center gap-3 rounded-md px-1.5 py-1.5 text-sm transition-colors duration-150 hover:bg-surface/80">
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                      s.done ? "bg-good text-white" : "bg-surface text-accent ring-1 ring-accent/30",
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
    </div>
  );
}
