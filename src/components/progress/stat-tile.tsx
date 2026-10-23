import type { ReactNode } from "react";
import { cn } from "@/components/ui";

// A tone only colours the small icon chip; the box and figure stay plain ink on white.
const tones = {
  accent: "bg-accent-soft text-accent",
  good: "bg-good/10 text-good",
  warn: "bg-mark-soft text-warn",
};
type Tone = keyof typeof tones;

/** A bordered box with a label and a condensed figure; tiles sit in a row. */
export function StatTile({ label, value, sub, icon, tone = "accent" }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-[13px] font-medium text-muted">{label}</p>
        {icon && <span aria-hidden className={cn("-m-1 grid h-7 w-7 shrink-0 place-items-center rounded-md [&_svg]:h-4 [&_svg]:w-4", tones[tone])}>{icon}</span>}
      </div>
      <p className="numeral mt-3 break-words text-[36px] text-text sm:text-[40px]">{value}</p>
      {sub && <p className="mt-2 text-[13px] text-muted [&_a:hover]:text-accent">{sub}</p>}
    </div>
  );
}
