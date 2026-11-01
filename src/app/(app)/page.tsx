"use client";

import Link from "next/link";
import { format } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarDays, Check, ChevronRight, MapPin } from "lucide-react";
import { db } from "@/lib/db";
import { daysBetween, fromDay } from "@/lib/dates";
import { useToday } from "@/lib/use-today";
import { byWhen, examTypeLabel, urgentMark } from "@/lib/exams";
import { examInMode, examSyllabus, modeShort, topicsInScope, useExamMode } from "@/lib/mode";
import { coverage } from "@/lib/stats";
import type { Exam } from "@/lib/types";
import { ExamCalendar, QuickSheets } from "@/components/today/rail";
import { Badge, CoverageBar, buttonClass, cn, daysTone, subjectStyle } from "@/components/ui";

// Progress bars on this page fill in emerald rather than the subject's colour: here they measure readiness.
const MASTERY = subjectStyle("var(--mastery)");
// The next exam's card: a breath of indigo on white in light; a plain card on dark, where an indigo wash turns muddy.
const HERO_BG = { background: "light-dark(color-mix(in oklab, var(--accent-soft) 55%, var(--surface)), var(--surface))" };

const daysLeft = (d: number) => (d === 0 ? "Today" : d === 1 ? "1 day left" : `${d} days left`);

/** The overall readiness figure as a small ring: emerald for what's covered, a slate track for the rest. */
function ReadinessRing({ value }: { value: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 40 40" className="h-11 w-11 shrink-0 -rotate-90" aria-hidden>
      <circle cx="20" cy="20" r={r} fill="none" stroke="var(--track)" strokeWidth="5" />
      <circle
        cx="20" cy="20" r={r} fill="none" stroke="var(--mastery)" strokeWidth="5" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)}
        className={cn("transition-[stroke-dashoffset] duration-700 ease-snappy", value === 0 && "opacity-0")}
      />
    </svg>
  );
}

export default function TodayPage() {
  const t = useToday();
  const data = useLiveQuery(async () => {
    const [subjects, topics, units, exams, examCount, syllabusFiles] = await Promise.all([
      db.subjects.toArray(),
      db.topics.toArray(),
      db.units.toArray(),
      db.exams.where("date").aboveOrEqual(t).toArray().then((es) => es.sort(byWhen)),
      db.exams.count(),
      db.materials.where("kind").equals("syllabus").count(),
    ]);
    return { subjects, topics, units, exams, examCount, syllabusFiles };
  }, [t]);
  const mode = useExamMode();
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
  const next = modeExams[0];
  const rest = modeExams.slice(1, 7);
  const nextSubject = subject(next?.subjectId);
  const nextDays = next ? daysBetween(t, next.date) : 0;
  const examTopics = (e: Exam) => examSyllabus(e, topics, units, mode);
  const nextTopics = next ? examTopics(next) : [];
  const nextRevised = nextTopics.filter((x) => x.status === "revised").length;
  const readiness = coverage(topicsInScope(topics, units, mode));
  // The exam's facts as small pills: the date (with the time, when the date sheet gave one), then the hall if known.
  const facts = next
    ? [
        { icon: CalendarDays, text: `${format(fromDay(next.date), "d MMM")}${next.time ? `, ${next.time}` : ""}` },
        ...(next.venue ? [{ icon: MapPin, text: next.venue }] : []),
      ]
    : [];

  return (
    // data-wide: the layout gives this page a wider column for its right-hand rail.
    <div data-wide className="space-y-8">
      {/* The date and the exam-mode switch live in the top bar above every page. */}
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <h1 className="min-w-0 font-display text-[28px] leading-[1.1] md:text-[34px]">
          {mode === "mid-term" ? "Mid-sem dashboard" : mode === "end-term" ? "Major exam dashboard" : "Study dashboard"}
        </h1>
        {/* Overall readiness: coverage of this exam mode's whole syllabus, every subject together. */}
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface py-2 pl-2 pr-4 shadow-sheet">
          <ReadinessRing value={readiness} />
          <div>
            <p className="text-[12px] font-medium text-muted">Overall readiness</p>
            <p className="text-[17px] font-bold leading-tight tabular-nums">{readiness}% ready</p>
          </div>
        </div>
      </header>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="min-w-0 space-y-8">
          {next ? (
            // The next exam, in the spotlight: the countdown on the left, what it covers and how ready you are on the right.
            <section aria-labelledby="next-heading" style={HERO_BG} className="count-in rounded-2xl border border-accent/20 p-6 shadow-sheet sm:p-8">
              <h2 id="next-heading" className="sr-only">Next exam</h2>
              <div className="grid gap-x-10 gap-y-7 md:grid-cols-[auto_minmax(0,1fr)]">
                <div>
                  <p className="numeral text-[88px] text-text md:text-[112px]">
                    <span className={urgentMark(nextDays)}>{nextDays === 0 ? "Today" : nextDays}</span>
                  </p>
                  {nextDays > 0 && <p className="mt-2 text-[12px] font-semibold uppercase tracking-[0.1em] text-muted">{nextDays === 1 ? "Day left" : "Days left"}</p>}
                  <ul className="mt-5 flex flex-wrap gap-2">
                    {facts.map(({ icon: Icon, text }) => (
                      <li key={text} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-[12.5px] font-medium text-text">
                        <Icon size={13} className="text-muted" aria-hidden />
                        <span className="tabular-nums">{text}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex min-w-0 flex-col md:pt-2">
                  <div style={subjectStyle(nextSubject?.color)} className="flex items-start gap-2.5">
                    <span aria-hidden className="subj-dot mt-2 h-2.5 w-2.5 shrink-0 rounded-full" />
                    <h3 className="line-clamp-2 break-words text-xl font-bold leading-snug tracking-[-0.015em] md:text-2xl">{nextSubject?.name ?? "Exam"}</h3>
                  </div>
                  <p className="mt-2 flex flex-wrap items-center gap-2 pl-5 text-sm text-muted">
                    {nextSubject?.code && <Badge className="font-semibold text-text">{nextSubject.code}</Badge>}
                    {examTypeLabel(next.type)}
                  </p>

                  <div className="mt-6" style={MASTERY}>
                    <CoverageBar topics={nextTopics} />
                    <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px] text-muted">
                      <span className="tabular-nums">{nextTopics.length ? `${nextRevised} of ${nextTopics.length} topics revised` : "No syllabus added for this exam yet"}</span>
                      {nextTopics.length > 0 && <span><strong className="font-bold tabular-nums text-text">{coverage(nextTopics)}%</strong> covered</span>}
                    </div>
                  </div>

                  <div className="mt-6 flex flex-wrap gap-2.5 md:mt-auto md:pt-6">
                    <Link href={`/subjects/view?id=${next.subjectId}&tab=syllabus`} className={buttonClass("primary", "md", "h-10 px-4")}>
                      Resume revision <ChevronRight size={16} aria-hidden />
                    </Link>
                    <Link href={`/exams/view?id=${next.id}`} className={buttonClass("secondary", "md", "h-10 px-4")}>Exam kit</Link>
                  </div>
                </div>
              </div>
            </section>
          ) : (
            <section className="rounded-2xl border border-dashed border-line-strong px-6 py-8">
              <p className="font-bold tracking-[-0.01em]">No {mode ? `${modeShort(mode).toLowerCase()} ` : ""}exams coming up</p>
              <p className="mt-1 text-sm text-muted">
                {examCount ? "Nothing upcoming in this exam mode. Add the next date sheet when it's out." : "Add your date sheet and the countdown starts here."}
              </p>
              <Link href="/exams" className={buttonClass("primary", "md", "mt-5 h-10 px-4")}>Add exams</Link>
            </section>
          )}

          {rest.length > 0 && (
            <section aria-labelledby="upcoming-heading">
              <div className="mb-4 flex items-baseline justify-between gap-3">
                <h2 id="upcoming-heading" className="text-[17px] font-bold tracking-[-0.01em]">Upcoming exams</h2>
                <Link href="/exams" className="group inline-flex items-center gap-0.5 text-sm font-medium text-accent">
                  All exams <ChevronRight size={15} aria-hidden className="transition-transform duration-200 ease-snappy group-hover:translate-x-0.5" />
                </Link>
              </div>
              <ul className="grid gap-4 sm:grid-cols-2">
                {rest.map((e) => {
                  const s = subject(e.subjectId);
                  const d = daysBetween(t, e.date);
                  const et = examTopics(e);
                  const pct = coverage(et);
                  return (
                    <li key={e.id}>
                      <Link
                        href={`/subjects/view?id=${e.subjectId}&tab=syllabus`}
                        style={subjectStyle(s?.color)}
                        className="group flex h-full flex-col rounded-2xl border border-border bg-surface p-5 shadow-sheet transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-lift"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            {s?.code && <Badge className="font-semibold text-text">{s.code}</Badge>}
                            <span className="truncate text-[13px] text-muted">{examTypeLabel(e.type)}</span>
                          </div>
                          <Badge tone={daysTone(d)}>{daysLeft(d)}</Badge>
                        </div>
                        <div className="mt-4 flex items-start gap-2.5">
                          <span aria-hidden className="subj-dot mt-[7px] h-2 w-2 shrink-0 rounded-full" />
                          <h3 className="line-clamp-2 break-words text-[16px] font-bold leading-snug tracking-[-0.01em]">{s?.name ?? "Exam"}</h3>
                        </div>
                        <p className="mt-1 pl-[18px] text-[13px] tabular-nums text-muted">
                          {format(fromDay(e.date), "d MMM, EEEE")}{e.time && `, ${e.time}`}
                        </p>
                        <div className="mt-5 flex items-center gap-3" style={MASTERY}>
                          <CoverageBar topics={et} />
                          <span className="w-10 shrink-0 text-right text-[13px] font-semibold tabular-nums">{pct}%</span>
                        </div>
                        <span className="mt-5 inline-flex items-center gap-1 border-t border-border pt-4 text-[13px] font-medium text-accent">
                          View topics <ChevronRight size={14} aria-hidden className="transition-transform duration-200 ease-snappy group-hover:translate-x-0.5" />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {onboarding && (
            <section aria-label="Get set up" className="rounded-2xl border border-accent/15 bg-accent-soft px-5 py-4 sm:px-6">
              <p className="mb-2 text-[15px] font-bold tracking-[-0.01em]">Get set up</p>
              <ol className="grid gap-1 sm:grid-cols-2">
                {steps.map((s, i) => (
                  <li key={i}>
                    <Link href={s.href} className="flex items-center gap-3 rounded-xl px-1.5 py-1.5 text-sm transition-colors duration-150 hover:bg-surface/80">
                      <span
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                          s.done ? "bg-mastery text-surface" : "bg-surface text-accent ring-1 ring-accent/30",
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

        {/* The action rail: beside the main column on wide screens, below it (two across where there's room) elsewhere. */}
        <aside aria-label="Study widgets" className="grid content-start items-start gap-5 md:grid-cols-2 xl:sticky xl:top-8 xl:grid-cols-1 xl:self-start">
          {/* Keyed by the month it opens on, so stepping through months starts over when the next exam changes. */}
          <ExamCalendar key={modeExams[0]?.date ?? t} today={t} exams={modeExams} subjects={subjects} />
          <QuickSheets subjects={subjects} />
        </aside>
      </div>
    </div>
  );
}
