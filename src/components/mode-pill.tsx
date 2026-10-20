"use client";

import { ArrowLeftRight } from "lucide-react";
import { modeShort, otherMode, setExamMode, useExamMode } from "@/lib/mode";
import { cn } from "./ui";

/** Current exam mode as a pill, with a one-tap switch to the other mode. */
export function ModePill({ className }: { className?: string }) {
  const mode = useExamMode();
  if (!mode) return null;
  const next = otherMode(mode);
  return (
    <div className={cn("inline-flex items-center gap-1 rounded-full bg-accent-soft py-1 pl-3 pr-1 text-[13px]", className)}>
      <span className="font-semibold text-accent">{modeShort(mode)} mode</span>
      <button
        type="button"
        onClick={() => setExamMode(next)}
        aria-label={`Switch to ${modeShort(next)} mode`}
        title={`Switch to ${modeShort(next)} mode`}
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-accent/80 transition-colors hover:bg-surface hover:text-accent"
      >
        <ArrowLeftRight size={13} aria-hidden /> Switch
      </button>
    </div>
  );
}
