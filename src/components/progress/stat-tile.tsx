import type { ReactNode } from "react";
import { cn } from "@/components/ui";

// A tone only tints the small icon; the box and figure stay plain ink on white.
const tones = {
  accent: "text-accent",
  good: "text-good",
  warn: "text-warn",
};
type Tone = keyof typeof tones;

/** A bordered box with a label and a condensed figure; tiles sit in a row. */
export function StatTile({ label, value, sub, icon, tone = "accent" }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-[13px] font-medium text-muted">{label}</p>
        {icon && <span aria-hidden className={cn("shrink-0 [&_svg]:h-4 [&_svg]:w-4", tones[tone])}>{icon}</span>}
      </div>
      <p className="numeral mt-3 break-words text-[36px] text-text sm:text-[40px]">{value}</p>
      {sub && <p className="mt-2 text-[13px] text-muted [&_a:hover]:text-accent">{sub}</p>}
    </div>
  );
}
