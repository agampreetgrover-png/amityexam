"use client";

import Link from "next/link";
import { format } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { BarChart3, Check, ChevronRight, Search, Settings as SettingsIcon } from "lucide-react";
import { useState } from "react";
import { db } from "@/lib/db";
import { daysBetween, fromDay, prettyDay } from "@/lib/dates";
import { useToday } from "@/lib/use-today";
import { examTypeLabel } from "@/lib/exams";
import { examInMode, examSyllabus, modeShort, useExamMode } from "@/lib/mode";
import { coverage } from "@/lib/stats";
import { openCommandPalette } from "@/components/command-palette-loader";
import { ModePill } from "@/components/mode-pill";
import { CoverageBar, Panel, cn, subjectStyle } from "@/components/ui";

const daysWord = (d: number) => (d === 0 ? "today" : d === 1 ? "day to go" : "days to go");

export default function TodayPage() {
  const t = useToday();
  const data = useLiveQuery(async () => {
    const [subjects, topics, units, exams, examCount, syllabusFiles] = await Promise.all([
      db.subjects.toArray(),
      db.topics.toArray(),
      db.units.toArray(),
      db.exams.where("date").aboveOrEqual(t).sortBy("date"),
      db.exams.count(),
      db.materials.where("kind").equals("syllabus").count(),
    ]);
    return { subjects, topics, units, exams, examCount, syllabusFiles };
  }, [t]);
  const mode = useExamMode();
  const [pickedExam, setPickedExam] = useState<number | null>(null);
  if (!data) return null;

  const { subjects, topics, units, exams, examCount, syllabusFiles } = data;
  // Everything on this page follows the chosen exam mode and its own syllabus.
  const subject = (id?: number) => subjects.find((s) => s.id === id);

  const steps = [
    { done: subjects.length > 0, label: "Add your subjects", href: "/subjects" },
    {
      // Any syllabus counts, mid-sem or major: topics from the Syllabus tab, or a syllabus uploaded or pasted as material.
      done: topics.length > 0 || syllabusFiles > 0,
      label: "Import your syllabus (AI reads it from a PDF)",
      href: subjects[0] ? `/subjects/view?id=${subjects[0].id}` : "/subjects",
    },
    { done: examCount > 0, label: "Add your exam date sheet", href: "/exams" },
  ];
  const onboarding = steps.some((s) => !s.done);

  const modeExams = exams.filter((e) => examInMode(e, mode));
  const shown = modeExams.find((e) => e.id === pickedExam) ?? modeExams[0];
  const shownSubject = subject(shown?.subjectId);
  const shownDays = shown ? daysBetween(t, shown.date) : 0;
  const examTopics = (e: (typeof exams)[number]) => examSyllabus(e, topics, units, mode);
  const examCoverage = (e: (typeof exams)[number]) => coverage(examTopics(e));
  const shownCoverage = shown ? examCoverage(shown) : 0;
  const shownTopics = shown ? examTopics(shown) : [];
  const shownRevised = shownTopics.filter((t) => t.status === "revised").length;
  const shownStudied = shownTopics.filter((t) => t.status === "studied").length;
  // The exam written out as a row from the date sheet. Date and day always show; time and hall only when known.
  const detailCells = shown
    ? [
        { label: "Date", value: format(fromDay(shown.date), "d MMM"), num: true },
        { label: "Day", value: format(fromDay(shown.date), "EEEE"), num: false },
        ...(shown.time ? [{ label: "Time", value: shown.time, num: true }] : []),
        ...(shown.venue ? [{ label: "Hall", value: shown.venue, num: false }] : []),
      ]
    : [];
  const mobileIcon = "press grid h-10 w-10 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text";

  return (
    <div className="space-y-10">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted">{format(fromDay(t), "EEEE, d MMMM")}</p>
          <h1 className="mt-1.5 font-display text-[28px] leading-[1.1] md:text-[34px]">
            {mode === "mid-term" ? "Mid-sem Dashboard" : mode === "end-term" ? "Major Exam Dashboard" : "Study Dashboard"}
          </h1>
          <ModePill className="mt-4 md:hidden" />
        </div>
        <div className="-mr-2 flex shrink-0 md:hidden">
          <button type="button" onClick={openCommandPalette} className={mobileIcon} aria-label="Search">
            <Search size={20} />
          </button>
          <Link href="/progress" className={mobileIcon} aria-label="Progress"><BarChart3 size={20} /></Link>
          <Link href="/settings" className={mobileIcon} aria-label="Settings"><SettingsIcon size={20} /></Link>
        </div>
      </header>

      {/* The date sheet: the chosen exam counted down in large figures, every upcoming exam of this mode listed beneath.
          Picking a row switches which exam the countdown follows. */}
      <section aria-labelledby="exams-heading">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="exams-heading" className="text-[15px] font-semibold tracking-[-0.01em]">Upcoming exams</h2>
          <Link href="/exams" className="group inline-flex items-center gap-0.5 rounded-md text-sm font-medium text-accent">
            All exams <ChevronRight size={15} className="transition-transform duration-200 ease-snappy group-hover:translate-x-0.5" />
          </Link>
        </div>
        {shown ? (
          <Panel>
            {/* The countdown takes the exam's subject colour: a tinted sheet with that colour's tab down its edge.
                Picking another exam below recolours it. */}
            <div
              key={shown.id}
              style={subjectStyle(shownSubject?.color)}
              className="subj-tint subj-edge-thick count-in grid gap-x-10 gap-y-6 p-6 pl-8 sm:grid-cols-[auto_1fr] sm:items-start sm:p-7 sm:pl-10"
            >
              {/* The countdown: the figure is the hero, its unit sat directly beneath so the two read as one. */}
              <div className="shrink-0">
                <span className="numeral subj-ink block text-[88px] md:text-[132px]">
                  <span className={cn(shownDays <= 3 && "mark")}>{shownDays}</span>
                </span>
                <span className="mt-1 block text-[13px] font-medium text-muted">{daysWord(shownDays)}</span>
              </div>
              <div className="min-w-0">
                {/* Phones: the name takes the full width and the Exam kit button drops below it. */}
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 sm:flex-nowrap">
                  <div className="min-w-0 basis-full sm:basis-auto">
                    <h3 className="line-clamp-2 break-words text-[22px] font-semibold leading-tight tracking-[-0.02em]">{shownSubject?.name ?? "Exam"}</h3>
                    <p className="mt-1 text-sm text-muted">{examTypeLabel(shown.type)}{shownSubject?.code ? `, ${shownSubject.code}` : ""}</p>
                  </div>
                  <Link
                    href={`/exams/view?id=${shown.id}`}
                    className="press group subj-line inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border bg-surface px-3 text-[13px] font-medium shadow-control hover:bg-surface-2"
                  >
                    Exam kit <ChevronRight size={15} className="-mr-1 text-muted transition-transform duration-200 ease-snappy group-hover:translate-x-0.5" />
                  </Link>
                </div>

                {/* The exam as a row from the date sheet: labelled cells over hairlines, the top rule in the subject's ink. */}
                {/* Phones: a two-column grid, since a wrapped row would start with a stray divider. */}
                <dl className="subj-line mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4 sm:flex sm:flex-wrap sm:gap-x-0">
                  {detailCells.map((c) => (
                    <div key={c.label} className="min-w-0 sm:border-l sm:border-border sm:pl-4 sm:pr-6 sm:first:border-l-0 sm:first:pl-0">
                      <dt className="text-[11px] font-medium text-faint">{c.label}</dt>
                      <dd className={cn("mt-0.5 break-words text-sm font-medium text-text sm:truncate", c.num && "tabular-nums")}>{c.value}</dd>
                    </div>
                  ))}
                </dl>

                {/* Are you ready: the coverage bar with its figure and a plain count of what's done. */}
                <div className="mt-5">
                  <div className="flex items-center gap-3">
                    <CoverageBar topics={shownTopics} className="h-2 max-w-sm bg-surface/90" />
                    <span className="shrink-0 text-[13px] text-muted"><strong className="font-semibold tabular-nums text-text">{shownCoverage}%</strong> covered</span>
                  </div>
                  <p className="mt-2 text-[13px] text-muted">
                    {shownTopics.length
                      ? `${shownRevised} of ${shownTopics.length} topics revised${shownStudied ? `, ${shownStudied} more studied` : ""}`
                      : "No syllabus added for this exam yet"}
                  </p>
                </div>
              </div>
            </div>
            {modeExams.length > 1 && (
              // Toggle buttons, not tabs: picking a row re-points the countdown above rather than opening a panel of its own.
              <div role="group" aria-label="Choose an exam" className="divide-y divide-border border-t border-border">
                {modeExams.slice(0, 8).map((e) => {
                  const s = subject(e.subjectId);
                  const d = daysBetween(t, e.date);
                  const on = e.id === shown.id;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setPickedExam(e.id!)}
                      style={subjectStyle(s?.color)}
                      className={cn(
                        "subj-tab grid w-full grid-cols-[3rem_1fr_auto] items-center gap-x-4 py-3 pl-6 pr-5 text-left transition-colors duration-150 sm:grid-cols-[3rem_1fr_9rem_3.5rem] sm:pl-8 sm:pr-6",
                        on ? "subj-wash" : "subj-hover",
                      )}
                    >
                      <span className="numeral text-[26px]"><span className={cn(d <= 3 && "mark")}>{d}</span></span>
                      <span className="min-w-0">
                        <span className={cn("line-clamp-2 break-words text-sm", on ? "subj-ink font-semibold" : "font-medium")}>{s?.name}</span>
                        <span className="mt-0.5 block truncate text-[13px] text-muted">{s?.code ? `${s.code}, ` : ""}{examTypeLabel(e.type)}</span>
                      </span>
                      <span className="hidden text-[13px] tabular-nums text-muted sm:block">{prettyDay(e.date)}{e.time && `, ${e.time}`}</span>
                      <span className="text-right text-[13px] font-medium tabular-nums text-muted">{examCoverage(e)}%</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Panel>
        ) : (
          <div className="rounded-xl border border-dashed border-line-strong px-6 py-7">
            <p className="font-semibold tracking-[-0.01em]">No {mode ? `${modeShort(mode).toLowerCase()} ` : ""}exams coming up</p>
            <p className="mt-1 text-sm text-muted">
              {examCount ? "Nothing upcoming in this exam mode. Add the next date sheet when it's out." : "Add your date sheet and the countdown starts here."}
            </p>
            <Link
              href="/exams"
              className="press mt-5 inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.14),var(--shadow-control)] hover:bg-accent-hover"
            >
              Add exams
            </Link>
          </div>
        )}
      </section>

      {onboarding && (
        <section aria-label="Get set up" className="rounded-xl border border-accent/15 bg-accent-soft/60 px-5 py-4 sm:px-6">
          <p className="mb-2 text-[15px] font-semibold tracking-[-0.01em]">Get set up</p>
          <ol className="grid gap-1 sm:grid-cols-2">
            {steps.map((s, i) => (
              <li key={i}>
                <Link href={s.href} className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 text-sm transition-colors duration-150 hover:bg-surface/80">
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                      s.done ? "bg-good text-bg" : "bg-surface text-accent ring-1 ring-accent/30",
                    )}
                  >
                    {s.done ? <Check size={12} strokeWidth={3} aria-label="Done" /> : i + 1}
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
