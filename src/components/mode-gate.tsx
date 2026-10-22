"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Check, GraduationCap } from "lucide-react";
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
    focus: ["Only the units your mid-sem covers, ticked in each subject's syllabus", "Mid-term and internal tests", "Notes, quizzes and predictions for minor papers"],
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
        <span className="flex items-center gap-2 text-[15px] font-semibold">
          <GraduationCap size={18} className="text-accent" aria-hidden />
          Amity Exams
        </span>
        <h1 className="mt-10 font-display text-[32px] leading-tight md:text-[40px]">What are you preparing for?</h1>
        <p className="mt-2 max-w-md text-[15px] leading-relaxed text-muted">
          Your planner, syllabus and AI study tools will focus on it. You can switch any time.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {CHOICES.map((c) => (
            <button
              key={c.mode}
              type="button"
              onClick={() => pick(c.mode)}
              disabled={saving != null}
              className={cn(
                "flex flex-col rounded-lg border border-border bg-surface p-5 text-left transition-colors duration-150 hover:border-accent md:p-6",
                "disabled:pointer-events-none",
                // The chosen panel stays marked while the mode is stored; the other one steps back.
                saving === c.mode && "border-accent bg-accent-soft",
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
              <span className="mt-auto pt-6 text-sm font-semibold text-accent">
                {saving === c.mode ? "Opening…" : "Start preparing"}
              </span>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
