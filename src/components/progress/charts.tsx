"use client";

import type { ReactNode } from "react";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

// Every chart is a single series in the accent hue: the axis labels carry identity,
// so colour never has to tell subjects apart (the subject palette isn't CVD-safe as a chart scale).
const AXIS = { stroke: "var(--muted)", fontSize: 12, tickLine: false, axisLine: { stroke: "var(--border)" } } as const;
const GRID = { stroke: "var(--border)", strokeDasharray: undefined, vertical: false } as const;

interface TipProps {
  active?: boolean;
  label?: string | number;
  payload?: readonly { value?: unknown; payload?: { full?: string } }[];
  unit: string;
}

function TooltipBox({ active, payload, label, unit }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-sm">
      <p className="font-medium">{payload[0].payload?.full ?? label}</p>
      <p className="text-muted">{String(payload[0].value)}{unit}</p>
    </div>
  );
}

/** Wraps a chart with a visually-hidden-by-default table view for accessibility. */
function ChartFrame({ children, rows, columns, height = 240 }: {
  children: ReactNode;
  rows: (string | number)[][];
  columns: string[];
  height?: number;
}) {
  return (
    <div>
      <div style={{ height }} className="w-full">{children}</div>
      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer select-none">Show as table</summary>
        <table className="mt-2 w-full text-left">
          <thead><tr>{columns.map((c) => <th key={c} className="py-1 pr-2 font-medium">{c}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border">{r.map((v, j) => <td key={j} className="py-1 pr-2 text-text">{v}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

export function CoverageChart({ data }: { data: { name: string; value: number }[] }) {
  const height = Math.max(120, data.length * 40 + 40);
  return (
    <ChartFrame height={height} columns={["Subject", "Coverage %"]} rows={data.map((d) => [d.name, d.value])}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 36, top: 4, bottom: 4 }}>
          <CartesianGrid {...GRID} vertical horizontal={false} />
          <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} unit="%" {...AXIS} />
          <YAxis type="category" dataKey="name" width={132} {...AXIS} tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)} />
          <Tooltip cursor={{ fill: "var(--surface-2)" }} content={(p) => <TooltipBox {...p} unit="% covered" />} />
          <Bar
            dataKey="value" fill="var(--accent)" maxBarSize={24} radius={[0, 4, 4, 0]}
            label={{ position: "right", fill: "var(--muted)", fontSize: 12, formatter: (v: unknown) => `${v}%` }}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function MinutesChart({ data }: { data: { label: string; full: string; value: number }[] }) {
  return (
    <ChartFrame columns={["Day", "Minutes"]} rows={data.map((d) => [d.full, d.value])}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: -16, right: 8, top: 8, bottom: 0 }} barCategoryGap={2}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={8} />
          <YAxis allowDecimals={false} {...AXIS} />
          <Tooltip cursor={{ fill: "var(--surface-2)" }} content={(p) => <TooltipBox {...p} unit=" min" />} />
          <Bar dataKey="value" fill="var(--accent)" maxBarSize={24} radius={[4, 4, 0, 0]} />
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
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} {...AXIS} />
          <Tooltip cursor={{ stroke: "var(--muted)", strokeWidth: 1 }} content={(p) => <TooltipBox {...p} unit="%" />} />
          <Line
            type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            dot={{ r: 4, fill: "var(--accent)", stroke: "var(--surface)", strokeWidth: 2 }}
            activeDot={{ r: 6, fill: "var(--accent)", stroke: "var(--surface)", strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
