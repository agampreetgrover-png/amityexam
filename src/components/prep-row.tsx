"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight, Flame } from "lucide-react";
import { useId, useState } from "react";
import { db } from "@/lib/db";
import { formatMins, type PrepRow } from "@/lib/prep";
import type { PrepLevel, TopicPrep } from "@/lib/types";
import { QuestionLine } from "@/components/pyq-question-line";
import { toast } from "@/components/toast";
import { Badge, Tick, cn, subjectStyle } from "@/components/ui";

// A rated topic as a list row, shared by Zero prep and Start here.
const IMPORTANCE = { 3: "Core", 2: "Regular", 1: "Minor" } as const;
const PREP_WORD: Record<PrepLevel, string> = { 0: "Zero prep", 1: "Light prep", 2: "Needs groundwork" };

/**
 * How much has to come before a topic, drawn as a staircase: a flat line for zero prep, then one step,
 * then two. Green for zero prep, which is what this page is looking for.
 */
export function PrepGlyph({ level, className }: { level: PrepLevel; className?: string }) {
  const d = ["M1.5 10.5H14.5", "M1.5 10.5H7V5.5H14.5", "M1.5 10.5H5.5V6.5H10V2.5H14.5"][level];
  return (
    <svg viewBox="0 0 16 13" width="16" height="13" aria-hidden className={cn("shrink-0", level === 0 ? "text-good" : "text-muted", className)}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A topic's weight as a badge: core stands out, minor recedes. */
function Weight({ importance, className }: { importance: TopicPrep["importance"]; className?: string }) {
  return (
    <Badge className={cn(importance === 3 && "border-line-strong text-text", importance === 1 && "text-faint", className)}>
      {IMPORTANCE[importance]}
    </Badge>
  );
}

export function PrepTopicRow({ row, showSubject }: { row: PrepRow; showSubject: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const { topic, subject, prep, count, hot, questions } = row;
  const done = topic.status !== "not-started";
  return (
    <li style={subjectStyle(subject.color)}>
      <div className="flex items-center gap-3 px-4 transition-colors duration-150 hover:bg-surface-2/50 sm:px-5">
        <Tick
          done={done}
          label={done ? `Mark ${topic.title} not started` : `Mark ${topic.title} studied`}
          onClick={() => db.topics.update(topic.id, { status: done ? "not-started" : "studied" }).catch(() => toast("Couldn't save that. Try again."))}
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left"
        >
          <span className="block min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-medium">
              <span className={cn("min-w-0 break-words transition-colors duration-150", done && "text-muted")}>{topic.title}</span>
              {hot && <Badge tone="warn"><Flame aria-hidden />Most asked</Badge>}
            </span>
            {/* Phones fold the Time, Weight and Asked columns in here, first, so the facts the list is sorted by lead. */}
            <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] tabular-nums text-muted">
              <span className="font-medium text-text sm:hidden">{formatMins(prep.mins)}</span>
              <Weight importance={prep.importance} className="sm:hidden" />
              {count > 0 && <Badge tone="accent" className="sm:hidden">{count}× asked</Badge>}
              {showSubject && (
                // A long subject name is cut to one line rather than wrapping three times on a phone.
                <span className="inline-flex min-w-0 max-w-full items-center gap-1.5" title={subject.name}>
                  <span aria-hidden className="subj-dot h-2 w-2 flex-none rounded-full" />
                  {subject.code ? (
                    <>
                      <Badge>{subject.code}</Badge>
                      <span className="sr-only">{subject.name}</span>
                    </>
                  ) : (
                    <span className="truncate">{subject.name}</span>
                  )}
                </span>
              )}
              {/* Alone, the staircase reads as a stray dash; it shows only beside what to learn first. */}
              {prep.needs ? (
                <span className="inline-flex min-w-0 items-center gap-1.5" title={PREP_WORD[prep.level]}>
                  <PrepGlyph level={prep.level} />
                  <span className="sr-only">{PREP_WORD[prep.level]}</span>
                  <span>First: {prep.needs}</span>
                </span>
              ) : (
                <span className="sr-only">{PREP_WORD[prep.level]}</span>
              )}
            </span>
          </span>
          <span className="hidden w-24 shrink-0 text-[13px] font-medium tabular-nums text-text sm:block">{formatMins(prep.mins)}</span>
          <span className="hidden w-24 shrink-0 sm:block"><Weight importance={prep.importance} /></span>
          <span className="hidden w-24 shrink-0 text-right text-[13px] sm:block">
            {count ? (
              <Badge tone="accent">{count}× asked</Badge>
            ) : (
              <span className="text-faint"><span aria-hidden>—</span><span className="sr-only">Not asked</span></span>
            )}
          </span>
          <ChevronDown size={16} aria-hidden className={cn("w-5 shrink-0 text-muted transition-transform duration-150 ease-snappy", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <div id={id} className="tab-in space-y-4 border-t border-border bg-surface-2/40 px-4 py-4 sm:pl-[3.375rem] sm:pr-5">
          {prep.why && (
            <div className="space-y-1">
              <p className="text-[12px] font-medium text-muted">Note</p>
              <p className="max-w-prose text-[14px] leading-relaxed text-text/85">{prep.why}</p>
            </div>
          )}
          {questions.length > 0 ? (
            <div>
              <p className="text-[12px] font-medium tabular-nums text-muted">
                {questions.length} past-paper question{questions.length === 1 ? "" : "s"}
              </p>
              <ul className="divide-y divide-border">
                {questions.map((q) => <QuestionLine key={q.id} q={q} />)}
              </ul>
            </div>
          ) : (
            <p className="text-[13px] text-muted">Not asked in your past papers yet.</p>
          )}
          <Link
            href={`/subjects/view?id=${subject.id}&tab=${questions.length ? "pyqs" : "syllabus"}`}
            className="group inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline"
          >
            Open in {subject.name} {questions.length ? "PYQs" : "syllabus"}{" "}
            <ChevronRight size={14} aria-hidden className="transition-transform duration-200 ease-snappy group-hover:translate-x-0.5" />
          </Link>
        </div>
      )}
    </li>
  );
}
