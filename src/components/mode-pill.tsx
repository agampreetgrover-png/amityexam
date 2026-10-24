"use client";

import { MODES, modeShort, setExamMode, useExamMode } from "@/lib/mode";
import type { ExamMode } from "@/lib/types";
import { toast } from "./toast";
import { Segmented } from "./ui";

/** The exam mode as a two-way switch: both seasons visible, one tap to change, with Undo. */
export function ModePill({ className }: { className?: string }) {
  const mode = useExamMode();
  if (!mode) return null;
  // Switching changes the whole app, so it says so and can be taken back in one tap.
  const switchMode = async (next: ExamMode) => {
    await setExamMode(next);
    toast(`Switched to ${modeShort(next).toLowerCase()} mode`, { label: "Undo", onClick: () => void setExamMode(mode) });
  };
  return (
    <Segmented
      label="Exam mode"
      size="sm"
      value={mode}
      onChange={switchMode}
      options={MODES.map((m) => ({ value: m, label: modeShort(m), title: m === mode ? `${modeShort(m)} mode` : `Switch to ${modeShort(m)} mode` }))}
      className={className}
    />
  );
}
