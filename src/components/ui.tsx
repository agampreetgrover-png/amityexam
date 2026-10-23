"use client";

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export const cn = (...c: ClassValue[]) => twMerge(clsx(c));

/** Sets a subject's colour for the .subj-* classes in globals.css on this element and its children. */
export const subjectStyle = (color?: string) => (color ? ({ "--subj": color } as CSSProperties) : undefined);

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover",
  secondary: "border border-border bg-surface text-text hover:border-line-strong hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-text",
  danger: "text-muted hover:bg-bad/10 hover:text-bad",
};

export function Button({ variant = "primary", size = "md", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      className={cn(
        "inline-flex select-none items-center justify-center gap-1.5 rounded-md font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40",
        size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3.5 text-sm",
        variants[variant],
        className,
      )}
      {...p}
    />
  );
}

/** A bordered panel for a self-contained object (a form, a dialog body, a grouped tool). */
export function Card({ className, children, title, action }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cn("rounded-lg border border-border bg-surface p-4 sm:p-5", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** An unboxed page section: a heading and its content, separated by whitespace rather than borders. */
export function Section({ className, children, title, action }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cn("py-1", className)}>
      {(title || action) && (
        <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
          {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Rows separated by hairlines; the default way to show a list of things. */
export function List({ className, children }: { className?: string; children: ReactNode }) {
  return <ul className={cn("divide-y divide-border border-y border-border", className)}>{children}</ul>;
}

const field =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text transition-[border-color,box-shadow] duration-150 placeholder:text-muted/70 hover:border-line-strong focus:border-accent focus:shadow-[0_0_0_3px_rgb(36_67_196/0.14)]";
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input className={cn(field, "h-9", className)} {...p} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={cn(field, "min-h-24 leading-relaxed", className)} {...p} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={cn(field, "h-9", className)} {...p} />;

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium text-muted bg-surface-2", className)}>{children}</span>;
}

/** Underlined tabs for switching views within a page. The rule under the chosen tab slides when it changes. */
export function Tabs<T extends string>({ value, onChange, options, className, label }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
  label: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState<{ x: number; w: number } | null>(null);
  // The first placement snaps; only later moves slide, so the rule never travels in on page load.
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const place = () => {
      const on = el.querySelector<HTMLElement>('[aria-selected="true"]');
      if (on) setBar({ x: on.offsetLeft, w: on.offsetWidth });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [value, options.length]);
  useEffect(() => {
    if (!bar || ready) return;
    const raf = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(raf);
  }, [bar, ready]);
  return (
    <div ref={wrap} role="tablist" aria-label={label} className={cn("relative flex gap-6 border-b border-border", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 border-transparent pb-2.5 pt-1 text-sm transition-colors duration-150",
            value === o.value ? "font-semibold text-text" : "text-muted hover:text-text",
            // Until the sliding rule is measured, the chosen tab draws its own.
            !bar && value === o.value && "border-accent",
          )}
        >
          {o.label}
        </button>
      ))}
      {bar && (
        <span
          aria-hidden
          className={cn("absolute -bottom-px left-0 h-0.5 bg-accent", ready && "transition-[transform,width] duration-200 ease-out")}
          style={{ transform: `translateX(${bar.x}px)`, width: bar.w }}
        />
      )}
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
    const t = setTimeout(() => setShown(false), 160);
    return () => clearTimeout(t);
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="sheet m-auto w-[calc(100%-2rem)] max-w-lg rounded-lg border border-border bg-surface p-0 text-text shadow-float"
    >
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close" className="-mr-2"><X size={18} /></Button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto px-5 pb-5 pt-4">{shown && children}</div>
    </dialog>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1.5 rounded-lg border border-dashed border-line-strong px-5 py-8">
      {icon && <div className="mb-1 text-muted">{icon}</div>}
      <p className="font-semibold">{title}</p>
      {children && <div className="max-w-prose text-sm leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

export function Progress({ value, className, color }: { value: number; className?: string; color?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}>
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }}
      />
    </div>
  );
}

export function PageHeader({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 border-b border-border pb-5">
      <div className="min-w-0">
        <h1 className="font-display text-[28px] leading-tight md:text-[32px]">{title}</h1>
        {sub && <p className="mt-1 text-[15px] text-muted">{sub}</p>}
      </div>
      {action}
    </header>
  );
}

/** Round tick used to mark a session or item done. It settles in once when ticked, not when it loads already done. */
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
        done ? "border-good bg-good text-white" : "border-line-strong hover:border-accent",
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
