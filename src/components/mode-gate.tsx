"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { ChevronRight, Loader2 } from "lucide-react";
import { LogoMark } from "./logo";
import { useState, type ReactNode } from "react";
import { getSettings } from "@/lib/db";
import { setExamMode } from "@/lib/mode";
import type { ExamMode } from "@/lib/types";
import { cn } from "./ui";

/** Shows the welcome screen until an exam mode is picked, then the app. */
export function ModeGate({ children }: { children: ReactNode }) {
  const mode = useLiveQuery(async () => (await getSettings()).examMode ?? null);
  if (mode === undefined) return null; // still loading
  if (mode === null) return <Welcome />;
  return <>{children}</>;
}

const CHOICES: { mode: ExamMode; title: string; blurb: string; focus: string[]; units: number }[] = [
  {
    mode: "mid-term",
    title: "Mid-semester exam",
    blurb: "The minor / mid-term exam, on part of the full syllabus.",
    focus: ["Only your mid-sem syllabus, added to each subject while in mid-sem mode", "Mid-term and internal tests", "Notes, quizzes and predictions for minor papers"],
    units: 2,
  },
  {
    mode: "end-term",
    title: "Major exam",
    blurb: "The end-semester exam on the full syllabus, with practicals and viva.",
    focus: ["Your full end-sem syllabus", "End-term, practical and viva dates", "Notes, quizzes and predictions for major papers"],
    units: 4,
  },
];

/**
 * How much of the syllabus a season covers, drawn like the syllabus strip on a subject: four units of topics,
 * the ones this exam asks about marked in indigo. A picture of scope, not progress.
 */
function Scope({ units }: { units: number }) {
  return (
    <span aria-hidden className="flex h-1.5 w-full max-w-60 gap-1.5">
      {[0, 1, 2, 3].map((u) => (
        <span key={u} className="flex flex-1 gap-[2px]">
          {[0, 1, 2, 3].map((t) => (
            <span key={t} className={cn("h-full flex-1 rounded-[2px]", u < units ? "bg-accent/80" : "bg-track")} />
          ))}
        </span>
      ))}
    </span>
  );
}

function Welcome() {
  const [saving, setSaving] = useState<ExamMode | null>(null);
  const pick = async (m: ExamMode) => {
    setSaving(m);
    try {
      await setExamMode(m); // the gate re-renders into the app once this is stored
    } catch {
      setSaving(null);
    }
  };

  return (
    <main className="flex min-h-dvh flex-col justify-center bg-bg px-4 py-10 sm:px-6 md:py-16">
      <div className="stagger mx-auto w-full max-w-2xl">
        <span className="flex items-center gap-2.5 text-[15px] font-semibold tracking-[-0.02em]">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-solid text-accent-ink" aria-hidden>
            <LogoMark size={17} />
          </span>
          Amity Exams
        </span>
        <h1 className="mt-10 text-balance font-display text-[30px] leading-[1.1] md:mt-12 md:text-[42px]">What are you preparing for?</h1>
        <p className="mt-2 max-w-md text-[15px] leading-relaxed text-muted">
          Your dashboard, syllabus and AI study tools will focus on it. You can switch any time.
        </p>

        {/* The two seasons as rows of one sheet, each a single press target, rather than a pair of look-alike cards. */}
        <div className="mt-8 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-sheet">
          {CHOICES.map((c) => (
            <button
              key={c.mode}
              type="button"
              onClick={() => pick(c.mode)}
              disabled={saving != null}
              aria-busy={saving === c.mode || undefined}
              className={cn(
                "group flex w-full items-center gap-4 px-5 py-5 text-left transition-[background-color,opacity] duration-150 ease-snappy focus-visible:-outline-offset-2 md:gap-6 md:px-6 md:py-6",
                "hover:bg-surface-2 active:bg-surface-3 disabled:cursor-default",
                // The chosen row stays marked while the mode is stored; the other one steps back.
                saving === c.mode && "bg-accent-soft hover:bg-accent-soft",
                saving != null && saving !== c.mode && "opacity-45 hover:bg-transparent",
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-semibold tracking-[-0.01em] md:text-[18px]">{c.title}</span>
                <span className="mt-1 block text-[14px] leading-relaxed text-muted">{c.blurb}</span>
                <span className="mt-4 block"><Scope units={c.units} /></span>
                <span className="mt-4 block space-y-1.5 text-[13.5px] leading-snug text-text/85">
                  {c.focus.map((f) => (
                    <span key={f} className="flex items-start gap-2.5">
                      <span aria-hidden className="mt-[0.45em] h-1 w-1 shrink-0 rounded-full bg-faint" />
                      {f}
                    </span>
                  ))}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-sm font-semibold text-accent">
                <span className="sr-only sm:not-sr-only">{saving === c.mode ? "Opening…" : "Start preparing"}</span>
                <span
                  aria-hidden
                  className="grid h-9 w-9 place-items-center rounded-full border border-border bg-surface transition-colors duration-150 group-hover:border-accent/40"
                >
                  {saving === c.mode ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <ChevronRight size={16} className="transition-transform duration-200 ease-snappy group-hover:translate-x-0.5" />
                  )}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
