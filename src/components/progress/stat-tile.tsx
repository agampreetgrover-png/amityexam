import type { ReactNode } from "react";
import { cn } from "@/components/ui";

const tones = {
  indigo: "from-indigo-500 to-indigo-600",
  emerald: "from-emerald-500 to-emerald-600",
  violet: "from-violet-500 to-purple-600",
  amber: "from-amber-400 to-orange-500",
};
export type Tone = keyof typeof tones;

/** A coloured card with a big figure; tiles sit in a row, one tone each. */
export function StatTile({ label, value, sub, icon, tone = "indigo" }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: Tone }) {
  return (
    <div className={cn("relative min-w-0 overflow-hidden rounded-2xl bg-gradient-to-br p-5 text-white shadow-sm", tones[tone])}>
      {icon && <div className="pointer-events-none absolute -right-3 -top-3 text-white/20 [&_svg]:h-24 [&_svg]:w-24">{icon}</div>}
      <p className="relative text-sm font-medium text-white/90">{label}</p>
      <p className="relative mt-2 text-3xl font-bold tabular-nums tracking-tight md:text-[34px]">{value}</p>
      {sub && <p className="relative mt-1.5 text-[13px] text-white/80 [&_a]:text-white">{sub}</p>}
    </div>
  );
}
