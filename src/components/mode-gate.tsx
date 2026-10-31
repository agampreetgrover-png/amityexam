"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Check, ChevronRight, GraduationCap } from "lucide-react";
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

const CHOICES: { mode: ExamMode; title: string; blurb: string; focus: string[] }[] = [
  {
    mode: "mid-term",
    title: "Mid-semester exam",
    blurb: "The minor / mid-term exam, on part of the full syllabus.",
    focus: ["Only your mid-sem syllabus, added to each subject while in mid-sem mode", "Mid-term and internal tests", "Notes, quizzes and predictions for minor papers"],
  },
  {
    mode: "end-term",
    title: "Major exam",
    blurb: "The end-semester exam on the full syllabus, with practicals and viva.",
    focus: ["Your full end-sem syllabus", "End-term, practical and viva dates", "Notes, quizzes and predictions for major papers"],
  },
];

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
    <main className="flex min-h-dvh flex-col justify-center bg-bg px-4 py-12 md:py-16">
      <div className="mx-auto w-full max-w-3xl">
        <span className="flex items-center gap-2.5 text-[15px] font-semibold tracking-[-0.02em]">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-solid text-accent-ink" aria-hidden>
            <GraduationCap size={16} />
          </span>
          Amity Exams
        </span>
        <h1 className="mt-12 font-display text-[32px] leading-[1.1] md:text-[44px]">What are you preparing for?</h1>
        <p className="mt-2 max-w-md text-[15px] leading-relaxed text-muted">
          Your dashboard, syllabus and AI study tools will focus on it. You can switch any time.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {CHOICES.map((c) => (
            <button
              key={c.mode}
              type="button"
              onClick={() => pick(c.mode)}
              disabled={saving != null}
              className={cn(
                "press group flex flex-col rounded-2xl border border-border bg-surface p-5 text-left shadow-sheet hover:border-line-strong hover:bg-surface-2 hover:shadow-lift md:p-6",
                "disabled:pointer-events-none",
                // The chosen panel stays marked while the mode is stored; the other one steps back.
                saving === c.mode && "border-accent",
                saving != null && saving !== c.mode && "opacity-50",
              )}
            >
              <span className="text-[18px] font-semibold">{c.title}</span>
              <span className="mt-1 text-[14px] leading-relaxed text-muted">{c.blurb}</span>
              <ul className="mt-4 space-y-2 text-sm">
                {c.focus.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check size={14} className="mt-[3px] shrink-0 text-good" aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>
              <span className="mt-auto inline-flex items-center gap-1 pt-6 text-sm font-semibold text-accent">
                {saving === c.mode ? "Opening…" : "Start preparing"}
                <ChevronRight size={15} aria-hidden className="transition-transform duration-200 ease-snappy group-hover:translate-x-0.5" />
              </span>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
