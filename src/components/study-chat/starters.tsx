"use client";

import { FileText, Flame, Sparkles, Target, Zap } from "lucide-react";
import type { ReactNode } from "react";
import type { StarterKind } from "@/lib/study-chat";
import { Badge, type BadgeTone } from "../ui";

const TILES: Record<StarterKind, { icon: ReactNode; title: string; badge: string; tone: BadgeTone }> = {
  predict: { icon: <Flame />, title: "High-yield prediction", badge: "High priority", tone: "warn" },
  model: { icon: <FileText />, title: "Model answer", badge: "Model answer", tone: "accent" },
  drill: { icon: <Zap />, title: "Rapid drill", badge: "Quick drill", tone: "neutral" },
  plan: { icon: <Target />, title: "Strategy", badge: "Study plan", tone: "good" },
};

/**
 * An empty chat: a greeting that says what answers draw on, then four starters built from the student's own
 * papers and syllabus. A tile sends its question.
 */
export function Starters({ subjectName, grounding, tiles, disabled, onPick }: {
  subjectName: string;
  grounding: string; // what answers come from, in a sentence
  tiles: { kind: StarterKind; prompt: string }[];
  disabled: boolean;
  onPick: (prompt: string) => void;
}) {
  return (
    // flex-1 in a min-h-full column: centred while it fits, scrollable (not clipped at the top) on a short screen.
    <div className="flex flex-1 flex-col items-center justify-center py-4 text-center sm:py-8">
      <span aria-hidden className="grid h-11 w-11 place-items-center rounded-xl bg-accent-soft text-accent">
        <Sparkles size={20} />
      </span>
      <h2 className="mt-4 max-w-xl text-balance text-xl font-semibold tracking-[-0.02em] sm:text-2xl">What are we mastering in {subjectName} today?</h2>
      <p className="mt-2 max-w-md text-pretty text-sm leading-relaxed text-muted">{grounding}</p>
      <ul className="mt-7 grid w-full grid-cols-1 gap-3 text-left sm:mt-8 sm:grid-cols-2">
        {tiles.map((t) => {
          const tile = TILES[t.kind];
          return (
            <li key={t.kind} className="flex">
              {/* Lifts on hover: a stronger edge and a soft shadow in light; on dark, where shadows don't read, a step up. */}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(t.prompt)}
                className="press flex w-full flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-sheet transition-[transform,border-color,box-shadow,background-color] duration-150 hover:-translate-y-0.5 hover:border-line-strong hover:bg-[color:light-dark(var(--surface),var(--surface-2))] hover:shadow-lift disabled:pointer-events-none disabled:opacity-45"
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted [&_svg]:size-4">{tile.icon}</span>
                  <Badge tone={tile.tone}>{tile.badge}</Badge>
                </span>
                <span className="mt-1 text-[14px] font-semibold">{tile.title}</span>
                <span className="line-clamp-2 text-[13px] leading-snug text-muted">{t.prompt}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
