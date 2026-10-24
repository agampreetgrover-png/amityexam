"use client";

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode, type RefObject, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import type { Topic, Unit } from "@/lib/types";

export const cn = (...c: ClassValue[]) => twMerge(clsx(c));

/** Sets a subject's colour for the .subj-* classes in globals.css on this element and its children. */
export const subjectStyle = (color?: string) => (color ? ({ "--subj": color } as CSSProperties) : undefined);

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  // A faint top highlight and a hairline shadow give the primary a pressed-ink feel without a gradient.
  primary: "bg-accent text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.14),var(--shadow-control)] hover:bg-accent-hover",
  secondary: "border border-border bg-surface text-text shadow-control hover:border-line-strong hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-text",
  danger: "text-muted hover:bg-bad/10 hover:text-bad",
};
const sizes = {
  sm: "h-8 px-2.5 text-[13px]",
  md: "h-9 px-3.5 text-sm",
  // Square, for a lone icon; give it an aria-label.
  icon: "h-8 w-8 px-0",
};

export function Button({ variant = "primary", size = "md", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof sizes }) {
  return (
    <button
      className={cn(
        "press inline-flex select-none items-center justify-center gap-1.5 rounded-lg font-medium disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0",
        sizes[size],
        variants[variant],
        className,
      )}
      {...p}
    />
  );
}

/** A white sheet with a padded body: a form, a tool, a self-contained object. */
export function Card({ className, children, title, action }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cn("rounded-xl border border-border bg-surface p-5 shadow-sheet sm:p-6", className)}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** A white sheet with no padding, for a table or a list of rows that run edge to edge. */
export function Panel({ className, children, as: Tag = "div" }: { className?: string; children: ReactNode; as?: "div" | "ul" | "section" }) {
  return <Tag className={cn("overflow-hidden rounded-xl border border-border bg-surface shadow-sheet", className)}>{children}</Tag>;
}

/** Column headings over a Panel's rows: small, quiet, ruled off from the rows. */
export const tableHead = "border-b border-border bg-surface-2/60 text-[12px] font-medium text-muted";

/** An unboxed page section: a heading and its content, separated by whitespace rather than borders. */
export function Section({ className, children, title, action }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cn("py-1", className)}>
      {(title || action) && (
        <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
          {title && <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Rows separated by hairlines; the default way to show a list of things inside a sheet. */
export function List({ className, children }: { className?: string; children: ReactNode }) {
  return <ul className={cn("divide-y divide-border border-y border-border", className)}>{children}</ul>;
}

// Focus shows as the blue border plus a soft ring, so the global outline is switched off for fields.
const field =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text shadow-control transition-[border-color,box-shadow] duration-150 placeholder:text-faint hover:border-line-strong focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_18%,transparent)] focus-visible:outline-none disabled:opacity-60 aria-[invalid=true]:border-bad";
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input className={cn(field, "h-9", className)} {...p} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={cn(field, "min-h-24 leading-relaxed", className)} {...p} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={cn(field, "select-chevron h-9", className)} {...p} />;

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium text-text/85">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-muted", className)}>{children}</span>;
}

/**
 * Measures the chosen item inside a container so a marker can slide to it. The first placement snaps;
 * only later moves glide, so nothing travels in on page load.
 */
function useSlider(wrap: RefObject<HTMLElement | null>, selector: string, deps: unknown[]) {
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const place = () => {
      const on = el.querySelector<HTMLElement>(selector);
      setBox(on ? { x: on.offsetLeft, w: on.offsetWidth } : null);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    document.fonts?.ready.then(place);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    if (!box || ready) return;
    const raf = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(raf);
  }, [box, ready]);
  return { box, ready };
}

/** Underlined tabs for switching sections of a page. The rule under the chosen tab slides when it changes. */
export function Tabs<T extends string>({ value, onChange, options, className, label }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
  label: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const { box: bar, ready } = useSlider(wrap, '[aria-selected="true"]', [value, options.length]);
  return (
    <div ref={wrap} role="tablist" aria-label={label} className={cn("relative flex gap-1 border-b border-border", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            // The first tab's label lines up with the page edge; its hover wash may reach past it.
            "group relative -mb-px whitespace-nowrap border-b-2 border-transparent px-1 pb-2.5 pt-1.5 text-sm transition-colors duration-150 first:-ml-3.5",
            value === o.value ? "font-semibold text-text" : "font-medium text-muted hover:text-text",
            // Until the sliding rule is measured, the chosen tab draws its own.
            !bar && value === o.value && "border-accent",
          )}
        >
          {/* The hover wash sits inside the tab's padding, so it never touches the rule. */}
          <span className="rounded-md px-2.5 py-1.5 transition-colors duration-150 group-hover:bg-surface-2 group-aria-selected:group-hover:bg-transparent">{o.label}</span>
        </button>
      ))}
      {bar && (
        <span
          aria-hidden
          className={cn("absolute -bottom-px left-0 h-0.5 rounded-full bg-accent", ready && "transition-[transform,width] duration-250 ease-snappy")}
          // Exactly under the label: the tab's own padding plus the wash's are trimmed off both ends.
          style={{ transform: `translateX(${bar.x + 14}px)`, width: Math.max(0, bar.w - 28) }}
        />
      )}
    </div>
  );
}

/** A compact either/or switch. A raised thumb slides under the chosen option. */
export function Segmented<T extends string>({ value, onChange, options, className, label, size = "md" }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  className?: string;
  label: string;
  size?: "sm" | "md";
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const { box, ready } = useSlider(wrap, '[aria-checked="true"]', [value, options.length]);
  return (
    <div ref={wrap} role="radiogroup" aria-label={label} className={cn("relative inline-flex rounded-lg bg-surface-2 p-0.5 ring-1 ring-inset ring-border", className)}>
      {box && (
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0.5 left-0 rounded-md bg-surface shadow-[0_1px_2px_var(--sheet-shade),0_0_0_1px_var(--border)]",
            ready && "transition-[transform,width] duration-250 ease-snappy",
          )}
          style={{ transform: `translateX(${box.x}px)`, width: box.w }}
        />
      )}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => value !== o.value && onChange(o.value)}
          className={cn(
            "relative z-10 inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-150",
            size === "sm" ? "h-7 px-2.5 text-[13px]" : "h-8 px-3.5 text-sm",
            value === o.value ? "text-text" : "text-muted hover:text-text",
            !box && value === o.value && "bg-surface shadow-control",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  // Children mount only once the dialog is showing, so their autoFocus lands inside it
  // instead of showModal() moving focus to the close button. On close they stay until the fade-out ends.
  const [shown, setShown] = useState(false);
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    if (open) {
      setShown(true);
      return;
    }
    const t = setTimeout(() => setShown(false), 180);
    return () => clearTimeout(t);
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="sheet m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-border bg-surface p-0 text-text shadow-float"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5 sm:px-6">
        <h2 className="min-w-0 truncate text-[16px] font-semibold tracking-[-0.01em]">{title}</h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="-mr-1.5"><X size={18} /></Button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto px-5 pb-6 pt-5 sm:px-6">{shown && children}</div>
    </dialog>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1.5 rounded-xl border border-dashed border-line-strong px-6 py-8">
      {icon && (
        <div className="mb-2 grid h-9 w-9 place-items-center rounded-lg bg-surface-2 text-muted ring-1 ring-inset ring-border [&_svg]:h-[18px] [&_svg]:w-[18px]">
          {icon}
        </div>
      )}
      <p className="font-semibold tracking-[-0.01em]">{title}</p>
      {children && <div className="max-w-prose text-sm leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

export function Progress({ value, className, color }: { value: number; className?: string; color?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}>
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-500 ease-snappy"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }}
      />
    </div>
  );
}

/**
 * Syllabus coverage as a two-tone bar: revised topics in the subject's full colour, studied ones (which count
 * half) in a paler band after them. Sits inside an element that sets --subj.
 */
export function CoverageBar({ topics, className }: { topics: Pick<Topic, "status">[]; className?: string }) {
  const n = topics.length || 1;
  const revised = (topics.filter((t) => t.status === "revised").length / n) * 100;
  const studied = (topics.filter((t) => t.status === "studied").length / n) * 100;
  return (
    <div className={cn("flex h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)} aria-hidden>
      <div className="subj-dot h-full transition-[width] duration-500 ease-snappy" style={{ width: `${revised}%` }} />
      <div
        className="h-full bg-[color-mix(in_oklab,var(--subj,var(--accent))_40%,var(--surface))] transition-[width] duration-500 ease-snappy"
        style={{ width: `${studied}%` }}
      />
    </div>
  );
}

const STATUS_WORD = { "not-started": "not started", studied: "studied", revised: "revised" } as const;

/**
 * The syllabus as a strip of cells, one per topic, in syllabus order, with a wider gap between units.
 * A revised topic fills in the subject's colour, a studied one in a paler shade. Hover a cell for its topic.
 */
export function SyllabusStrip({ units, topics, className }: { units: Unit[]; topics: Topic[]; className?: string }) {
  const groups = units.map((u) => topics.filter((t) => t.unitId === u.id)).filter((g) => g.length);
  const placed = new Set(groups.flat());
  const loose = topics.filter((t) => !placed.has(t));
  if (loose.length) groups.push(loose);
  if (!topics.length) return null;
  const revised = topics.filter((t) => t.status === "revised").length;
  const studied = topics.filter((t) => t.status === "studied").length;
  return (
    <div
      role="img"
      aria-label={`${revised} of ${topics.length} topics revised, ${studied} studied`}
      className={cn("flex h-2 w-full gap-1.5", className)}
    >
      {groups.map((g, i) => (
        <div key={i} className="flex h-full gap-px sm:gap-[2px]" style={{ flexGrow: g.length, flexBasis: 0 }}>
          {g.map((t) => <span key={t.id} className="strip-cell" data-s={t.status} title={`${t.title}: ${STATUS_WORD[t.status]}`} />)}
        </div>
      ))}
    </div>
  );
}

export function PageHeader({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 md:mb-10">
      <div className="min-w-0">
        <h1 className="font-display text-[28px] leading-[1.1] md:text-[34px]">{title}</h1>
        {sub && <p className="mt-2 text-[15px] text-muted">{sub}</p>}
      </div>
      {action}
    </header>
  );
}

/** Round tick used to mark an item done. It settles in once when ticked, not when it loads already done. */
export function Tick({ done, onClick, label }: { done: boolean; onClick: () => void; label: string }) {
  const was = useRef(done);
  const [pop, setPop] = useState(false);
  useEffect(() => {
    if (done && !was.current) setPop(true);
    if (!done) setPop(false);
    was.current = done;
  }, [done]);
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={done}
      onClick={onClick}
      className={cn(
        "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors duration-150",
        done ? "border-good bg-good text-bg" : "border-line-strong hover:border-accent",
        pop && "tick-done",
      )}
    >
      {done && (
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
          <path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
