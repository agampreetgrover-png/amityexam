"use client";

import { ArrowRight, FileText, Flame, Target, Zap } from "lucide-react";
import type { ReactNode } from "react";
import type { StarterKind } from "@/lib/study-chat";
import { Panel } from "../ui";

const KINDS: Record<StarterKind, { icon: ReactNode; label: string }> = {
  predict: { icon: <Flame />, label: "High-yield prediction" },
  model: { icon: <FileText />, label: "Model answer" },
  drill: { icon: <Zap />, label: "Rapid drill" },
  plan: { icon: <Target />, label: "Strategy" },
};

/**
 * An empty chat: what answers draw on, then four questions built from the student's own papers and syllabus, as
 * rows the student can send with one tap. The question itself leads each row; what kind of answer it gets sits
 * under it. From tablets up it sits at the foot of the conversation, right above the box it would be typed in.
 */
export function Starters({ grounding, tiles, disabled, onPick }: {
  grounding: string; // what answers come from, in a sentence
  tiles: { kind: StarterKind; prompt: string }[];
  disabled: boolean;
  onPick: (prompt: string) => void;
}) {
  return (
    // flex-1 in a min-h-full column: anchored to the bottom while it fits, scrollable (not clipped) on a short screen.
    <div className="flex flex-1 flex-col justify-end py-2 md:py-4">
      <h2 className="text-balance text-[15px] font-semibold tracking-[-0.01em]">Start with one of these, or ask your own below</h2>
      <p className="mt-1.5 max-w-prose text-pretty text-sm leading-relaxed text-muted">{grounding}</p>
      <Panel as="ul" className="mt-4 divide-y divide-border">
        {tiles.map((t) => {
          const kind = KINDS[t.kind];
          return (
            <li key={t.kind}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(t.prompt)}
                // A row inside a panel darkens a step under the finger rather than shrinking (.press) away from its rules.
                className="group/row flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:-outline-offset-2 active:bg-surface-3 disabled:pointer-events-none disabled:opacity-45 sm:px-5"
              >
                <span aria-hidden className="mt-0.5 shrink-0 text-muted transition-colors duration-150 group-hover/row:text-accent [&_svg]:size-4">
                  {kind.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-pretty text-[14px] font-medium leading-snug text-text">{t.prompt}</span>
                  <span className="mt-0.5 block text-[12.5px] text-muted">{kind.label}</span>
                </span>
                {/* Nudges toward the box on hover: this row sends its question. */}
                <ArrowRight
                  size={16}
                  aria-hidden
                  className="mt-0.5 shrink-0 text-faint transition-[transform,color] duration-150 ease-snappy group-hover/row:translate-x-0.5 group-hover/row:text-accent"
                />
              </button>
            </li>
          );
        })}
      </Panel>
    </div>
  );
}
