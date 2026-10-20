"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight, BookOpenCheck, Check, GraduationCap, Trophy } from "lucide-react";
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

const CHOICES: { mode: ExamMode; title: string; blurb: string; tile: string; icon: ReactNode; focus: string[] }[] = [
  {
    mode: "mid-term",
    title: "Mid-semester exam",
    blurb: "The minor / mid-term exam, with its own syllabus you upload.",
    tile: "from-indigo-500 to-violet-500",
    icon: <BookOpenCheck size={26} />,
    focus: ["Your mid-sem syllabus, kept separate from the major one", "Mid-term and internal tests", "Notes, quizzes and predictions for minor papers"],
  },
  {
    mode: "end-term",
    title: "Major exam",
    blurb: "The end-semester exam on the full syllabus, with practicals and viva.",
    tile: "from-amber-400 to-orange-500",
    icon: <Trophy size={26} />,
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
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-3xl">
        <div className="mb-10 flex flex-col items-center text-center">
          <span className="mb-5 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-ink shadow-sm">
              <GraduationCap size={23} />
            </span>
            <span className="text-xl font-bold tracking-tight">Amity Exams</span>
          </span>
          <h1 className="text-[30px] font-bold leading-tight tracking-tight md:text-[40px]">What are you preparing for?</h1>
          <p className="mt-2 max-w-md text-[15px] text-muted">
            Your planner, syllabus and AI study tools will focus on it. You can switch any time.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {CHOICES.map((c) => (
            <button
              key={c.mode}
              type="button"
              onClick={() => pick(c.mode)}
              disabled={saving != null}
              className={cn(
                "group flex flex-col rounded-2xl border border-border bg-surface p-6 text-left shadow-[0_1px_3px_rgb(17_24_39/0.06)] transition",
                "hover:-translate-y-0.5 hover:shadow-md hover:ring-2 hover:ring-accent/60",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                "disabled:pointer-events-none",
                saving === c.mode && "ring-2 ring-accent",
                saving != null && saving !== c.mode && "opacity-50",
              )}
            >
              <span className={cn("flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-sm", c.tile)}>{c.icon}</span>
              <span className="mt-5 text-xl font-bold tracking-tight">{c.title}</span>
              <span className="mt-1 text-[15px] text-muted">{c.blurb}</span>
              <ul className="mt-5 space-y-2 text-sm">
                {c.focus.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check size={16} className="mt-0.5 shrink-0 text-good" aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>
              <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-accent">
                {saving === c.mode ? "Opening…" : "Start preparing"}
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
              </span>
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
