"use client";

import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn, subjectStyle } from "@/components/ui";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

// Coverage bars wear each subject's colour so they match the rest of the app, but the axis labels still
// name every bar: colour never has to tell subjects apart on its own (the palette isn't CVD-safe as a scale).
// Other charts are one series in ballpoint blue.
const AXIS = { stroke: "var(--muted)", fontSize: 12, tickLine: false, axisLine: { stroke: "var(--border)" } } as const;
const GRID = { stroke: "var(--border)", vertical: false } as const;

interface TipProps {
  active?: boolean;
  label?: string | number;
  payload?: readonly { value?: unknown; payload?: { full?: string } }[];
  unit: string;
}

function TooltipBox({ active, payload, label, unit }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-float">
      <p className="font-medium text-text">{payload[0].payload?.full ?? label}</p>
      <p className="mt-0.5 tabular-nums text-muted">{String(payload[0].value)}{unit}</p>
    </div>
  );
}

/** Wraps a chart with a visually-hidden-by-default table view for accessibility. */
function ChartFrame({ children, rows, columns, height = 240, phone }: {
  children: ReactNode;
  rows: (string | number)[][];
  columns: string[];
  height?: number;
  phone?: ReactNode; // a form that suits a narrow screen better; the chart then shows from sm up
}) {
  return (
    <div>
      {phone && <div className="sm:hidden">{phone}</div>}
      <div style={{ height }} className={cn("w-full", phone && "hidden sm:block")}>{children}</div>
      <details className="mt-2 text-[13px] text-muted">
        <summary className="inline-flex cursor-pointer select-none items-center gap-1 rounded-md py-1 transition-colors duration-150 hover:text-text"><ChevronRight size={14} className="chev" aria-hidden /> Show as table</summary>
        <table className="mt-2 w-full text-left">
          <thead><tr className="border-b border-border">{columns.map((c) => <th key={c} className="py-1.5 pr-2 text-[12px] font-medium text-muted">{c}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border last:border-b-0">{r.map((v, j) => <td key={j} className="py-1.5 pr-2 tabular-nums text-text">{v}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

// Animations off: they re-render every bar/dot each frame for about 1.5 s and made /progress slow to settle.
// interval={0} on the y axes skips measuring each tick label; the ticks are always 40px+ apart.
export function CoverageChart({ data }: { data: { name: string; color?: string; value: number }[] }) {
  const height = Math.max(120, data.length * 40 + 40);
  // Phones: a 132px label column would cut every name short, so each bar gets its full name and value above it.
  const phone = (
    <ul className="space-y-3.5">
      {data.map((d) => (
        <li key={d.name} style={subjectStyle(d.color)}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 break-words text-text">{d.name}</span>
            <span className="shrink-0 tabular-nums text-muted">{d.value}%</span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-surface-2" aria-hidden>
            <div className="subj-dot h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, d.value))}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
  return (
    <ChartFrame height={height} columns={["Subject", "Coverage %"]} rows={data.map((d) => [d.name, d.value])} phone={phone}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 36, top: 4, bottom: 4 }}>
          <CartesianGrid {...GRID} vertical horizontal={false} />
          <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} unit="%" {...AXIS} />
          <YAxis type="category" dataKey="name" width={132} interval={0} {...AXIS} tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)} />
          <Tooltip cursor={{ fill: "var(--surface-2)" }} content={(p) => <TooltipBox {...p} unit="% covered" />} />
          <Bar
            dataKey="value" fill="var(--accent)" maxBarSize={20} radius={[0, 3, 3, 0]} isAnimationActive={false}
            label={{ position: "right", fill: "var(--muted)", fontSize: 12, formatter: (v: unknown) => `${v}%` }}
          >
            {data.map((d) => <Cell key={d.name} className="subj-fill" style={subjectStyle(d.color)} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function QuizTrendChart({ data }: { data: { label: string; full: string; value: number }[] }) {
  return (
    <ChartFrame columns={["Attempt", "Score %"]} rows={data.map((d) => [d.full, d.value])}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ left: -16, right: 16, top: 8, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={8} />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} interval={0} {...AXIS} />
          <Tooltip cursor={{ stroke: "var(--border)", strokeWidth: 1 }} content={(p) => <TooltipBox {...p} unit="%" />} />
          <Line
            type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" isAnimationActive={false}
            dot={{ r: 3, fill: "var(--accent)", stroke: "var(--surface)", strokeWidth: 1.5 }}
            activeDot={{ r: 4.5, fill: "var(--accent)", stroke: "var(--surface)", strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
