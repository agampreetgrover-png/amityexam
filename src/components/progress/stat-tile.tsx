import type { ReactNode } from "react";
import { cn } from "@/components/ui";

// A tone only colours the small icon chip; the box and figure stay plain ink on white.
const tones = {
  accent: "bg-accent-soft text-accent",
  good: "bg-good/10 text-good",
  warn: "bg-warn/10 text-warn",
};
type Tone = keyof typeof tones;

/** A bordered box with a label and a condensed figure; tiles sit in a row. */
export function StatTile({ label, value, sub, icon, tone = "accent" }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface p-4 shadow-sheet sm:p-6">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-[13px] font-medium text-muted">{label}</p>
        {icon && <span aria-hidden className={cn("-m-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg [&_svg]:h-4 [&_svg]:w-4", tones[tone])}>{icon}</span>}
      </div>
      <p className="numeral mt-4 whitespace-nowrap text-[36px] text-text sm:text-[44px]">{value}</p>
      {sub && <p className="mt-2 text-[13px] text-muted [&_a:hover]:text-accent">{sub}</p>}
    </div>
  );
}
