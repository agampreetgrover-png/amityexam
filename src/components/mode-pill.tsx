"use client";

import { modeShort, otherMode, setExamMode, useExamMode } from "@/lib/mode";
import { toast } from "./toast";
import { cn } from "./ui";

/** Current exam mode as a pill, with a one-tap switch to the other mode. */
export function ModePill({ className }: { className?: string }) {
  const mode = useExamMode();
  if (!mode) return null;
  const next = otherMode(mode);
  // Switching changes the whole app, so it says so and can be taken back in one tap.
  const switchMode = async () => {
    await setExamMode(next);
    toast(`Switched to ${modeShort(next).toLowerCase()} mode`, { label: "Undo", onClick: () => void setExamMode(mode) });
  };
  return (
    <div className={cn("inline-flex items-center gap-2 rounded-full border border-border bg-surface py-0.5 pl-3 pr-1 text-[13px]", className)}>
      <span className="font-medium text-text">{modeShort(mode)} mode</span>
      <button
        type="button"
        onClick={switchMode}
        aria-label={`Switch to ${modeShort(next)} mode`}
        title={`Switch to ${modeShort(next)} mode`}
        className="rounded-full px-2 py-0.5 font-medium text-accent transition-colors duration-150 hover:bg-accent-soft"
      >
        Switch
      </button>
    </div>
  );
}
