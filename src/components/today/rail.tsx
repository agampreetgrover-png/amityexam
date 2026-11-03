"use client";

import Link from "next/link";
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { useState, type ReactNode } from "react";
import { db } from "@/lib/db";
import { daysBetween, fromDay, toDay } from "@/lib/dates";
import { examTypeLabel, urgency } from "@/lib/exams";
import type { Exam, Subject } from "@/lib/types";
import { Badge, cn, daysTone, subjectStyle } from "@/components/ui";

/**
 * One card in Today's right-hand rail: a title row and its body. A container, so a header action can take a line of
 * its own when the card is narrow (half a tablet column) instead of breaking the title over two lines.
 */
function RailCard({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="@container rounded-2xl border border-border bg-surface p-5 shadow-sheet">
      <div className="mb-4 flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="whitespace-nowrap text-[15px] font-bold tracking-[-0.01em]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

// Practicals and vivas are marked apart from written papers: a dashed square instead of a filled circle, so the
// difference shows by shape as well as by the legend. Both take the urgency colour: coral under a week, amber under
// two, indigo after that.
const isPractical = (e: Pick<Exam, "type">) => e.type === "practical" || e.type === "viva";
const PAPER = {
  critical: "bg-critical text-surface",
  soon: "bg-mark-ink text-surface",
  later: "bg-accent-solid text-accent-ink",
  past: "bg-surface-3 text-muted",
} as const;
const PRACTICAL = {
  critical: "border-critical bg-critical-soft text-critical",
  soon: "border-mark-ink bg-mark-soft text-mark-ink",
  later: "border-accent bg-accent/10 text-accent",
  past: "border-line-strong text-muted",
} as const;

/**
 * A month of the date sheet. Written papers are filled circles and practicals dashed squares, coloured by how close
 * they are; today is ringed. Opens on the month of the next exam; the arrows step through the others.
 */
export function ExamCalendar({ today, exams, subjects }: { today: string; exams: Exam[]; subjects: Subject[] }) {
  const [offset, setOffset] = useState(0);
  // Which way the last arrow went, so the new month slides in from that side. None on first show.
  const [dir, setDir] = useState<"next" | "prev" | null>(null);
  const stepTo = (by: 1 | -1) => {
    setDir(by > 0 ? "next" : "prev");
    setOffset((o) => o + by);
  };
  const base = startOfMonth(fromDay(exams[0]?.date ?? today));
  const month = addMonths(base, offset);
  const days = eachDayOfInterval({ start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }) });
  const onDay = new Map<string, Exam[]>();
  for (const e of exams) onDay.set(e.date, [...(onDay.get(e.date) ?? []), e]);
  const subject = (id: number) => subjects.find((s) => s.id === id);
  const inMonth = exams.filter((e) => isSameMonth(fromDay(e.date), month));
  const hasPractical = inMonth.some(isPractical);
  // 28px arrows, widened to 40px on touch screens by an invisible ring.
  const step =
    "press relative grid h-7 w-7 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text pointer-coarse:before:absolute pointer-coarse:before:-inset-1.5 pointer-coarse:before:content-['']";
  // What a marked day says to a screen reader and in its tooltip: the date, then each exam on it.
  const dayLabel = (d: Date, list: Exam[]) => {
    const left = daysBetween(today, toDay(d));
    const when = left === 0 ? "today" : left === 1 ? "1 day left" : `${left} days left`;
    const what = list.map((e) => `${subject(e.subjectId)?.name ?? "Exam"}, ${examTypeLabel(e.type).toLowerCase()}`).join("; ");
    return `${format(d, "d MMMM")}: ${what} (${when})`;
  };

  return (
    <RailCard
      title="Exam calendar"
      action={
        // Beside the title where the card is wide enough; otherwise a row of its own, arrows at either end.
        <div className="flex w-full items-center justify-between gap-1 @[19rem]:w-auto @[19rem]:justify-end">
          <button type="button" className={step} onClick={() => stepTo(-1)} aria-label="Previous month"><ChevronLeft size={16} aria-hidden /></button>
          <span className="min-w-[6.5rem] whitespace-nowrap text-center text-[13px] font-semibold tabular-nums" aria-live="polite">{format(month, "MMMM yyyy")}</span>
          <button type="button" className={step} onClick={() => stepTo(1)} aria-label="Next month"><ChevronRight size={16} aria-hidden /></button>
        </div>
      }
    >
      {/* Only the marked days are read out (as links to their exam); the weekday letters and plain dates are hidden. */}
      {/* The weekday letters stay put; only the days below them move when the month changes. */}
      <div className="grid grid-cols-7 text-center">
        {WEEKDAYS.map((d, i) => <span key={i} aria-hidden className={cn("pb-1 text-[11px] font-semibold", i > 4 ? "text-faint" : "text-muted")}>{d}</span>)}
      </div>
      {/* overflow-clip keeps the sliding days inside the card; the padding leaves room for today's ring and the hover lift. */}
      <div className="-mx-1 -mb-1 overflow-clip px-1 pb-1 pt-1.5">
      <div key={offset} className={cn("grid grid-cols-7 gap-y-1.5 text-center", dir === "next" && "month-next", dir === "prev" && "month-prev")}>
        {days.map((d) => {
          const key = toDay(d);
          const here = onDay.get(key);
          const isToday = key === today;
          const tone = urgency(daysBetween(today, key));
          // A day with a written paper and a practical shows as the paper; the dots underneath still list both.
          const practical = here?.every(isPractical);
          const mark = cn(
            "grid h-8 w-8 place-items-center text-[12.5px] tabular-nums",
            !here && "rounded-full",
            // Days of the months either side are quieter than this month's, but still at a readable contrast (4.5:1+):
            // --faint in full, not faded further with an opacity.
            !here && (isSameMonth(d, month) ? "text-text" : "text-faint"),
            here && "font-semibold",
            here && !practical && cn("rounded-full", PAPER[tone]),
            here && practical && cn("rounded-lg border-2 border-dashed", PRACTICAL[tone]),
            isToday && !here && "font-semibold text-accent ring-2 ring-inset ring-accent",
            isToday && here && "ring-2 ring-accent ring-offset-2 ring-offset-surface",
          );
          return (
            // gap-1.5: today's offset ring around an exam day reaches 4px out and would otherwise touch the dots.
            <span key={key} aria-hidden={!here || undefined} className="flex flex-col items-center gap-1.5 py-0.5">
              {here ? (
                // An exam day opens its exam kit (the first one, when two fall on the same day).
                <Link
                  href={`/exams/view?id=${here[0].id}`}
                  aria-label={dayLabel(d, here)}
                  title={dayLabel(d, here)}
                  className={cn(
                    mark,
                    "relative transition-[transform,box-shadow] duration-150 ease-snappy hover:scale-110 hover:shadow-lift active:scale-95",
                    "pointer-coarse:before:absolute pointer-coarse:before:-inset-1 pointer-coarse:before:content-['']",
                  )}
                >
                  {format(d, "d")}
                </Link>
              ) : (
                <span className={mark}>{format(d, "d")}</span>
              )}
              <span aria-hidden className="flex h-1.5 gap-0.5">
                {here?.slice(0, 3).map((e) => <span key={e.id} className="subj-dot h-1.5 w-1.5 rounded-full" style={subjectStyle(subject(e.subjectId)?.color)} />)}
              </span>
            </span>
          );
        })}
      </div>
      </div>
      {/* What the two marks mean; the practical one only when this month has a practical. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted" aria-hidden>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-accent-solid" />Written paper</span>
        {hasPractical && <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-[3px] border-2 border-dashed border-accent" />Practical / viva</span>}
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-full ring-2 ring-inset ring-accent" />Today</span>
      </div>
      {/* The same exams as text, so the calendar never relies on colour or a mark alone. */}
      {inMonth.length ? (
        <ul className="mt-4 space-y-2 border-t border-border pt-4">
          {inMonth.map((e) => {
            const s = subject(e.subjectId);
            const d = daysBetween(today, e.date);
            return (
              <li key={e.id} style={subjectStyle(s?.color)} className="flex items-center gap-2.5 text-[13px]">
                <span aria-hidden className={cn("subj-dot h-2 w-2 shrink-0", isPractical(e) ? "rounded-[2px]" : "rounded-full")} />
                <span className="w-12 shrink-0 font-semibold tabular-nums">{format(fromDay(e.date), "d MMM")}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{s?.code || s?.name}, {examTypeLabel(e.type).toLowerCase()}</span>
                <Badge tone={daysTone(d)}>
                  {d === 0 ? "Today" : <><span aria-hidden>{d}d</span><span className="sr-only">{d === 1 ? "1 day" : `${d} days`} left</span></>}
                </Badge>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 border-t border-border pt-4 text-[13px] text-muted">No exams in {format(month, "MMMM")}.</p>
      )}
    </RailCard>
  );
}

/** The latest cheat sheets and short notes written in any subject, one tap from Today. */
export function QuickSheets({ subjects }: { subjects: Subject[] }) {
  const docs = useLiveQuery(
    () => db.docs.filter((d) => d.kind === "cheatsheet" || d.kind === "summary").reverse().sortBy("createdAt").then((ds) => ds.slice(0, 5)),
    [],
  );
  const subject = (id: number) => subjects.find((s) => s.id === id);
  return (
    <RailCard title="Quick cheat sheets">
      {!docs ? null : docs.length ? (
        <ul className="-mx-2 space-y-0.5">
          {docs.map((d) => (
            <li key={d.id}>
              <Link
                href={`/subjects/view?id=${d.subjectId}&tab=notes`}
                className="press group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2 focus-visible:outline-offset-0"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><FileText size={16} aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{d.title}</span>
                  <span className="block truncate text-xs text-muted">{subject(d.subjectId)?.name ?? "Subject"}, {d.kind === "cheatsheet" ? "cheat sheet" : "short notes"}</span>
                </span>
                <ChevronRight size={15} aria-hidden className="shrink-0 text-faint transition-[transform,color] duration-200 ease-snappy group-hover:translate-x-0.5 group-hover:text-accent" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No cheat sheets yet. Write one from a subject&apos;s Notes tab and it shows up here.</p>
      )}
    </RailCard>
  );
}
