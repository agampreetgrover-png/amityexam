"use client";

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { X } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export const cn = (...c: ClassValue[]) => twMerge(clsx(c));

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:opacity-90",
  secondary: "border border-border bg-surface text-text hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-text",
  danger: "text-muted hover:bg-bad/10 hover:text-bad",
};

export function Button({ variant = "primary", size = "md", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-40",
        size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-10 px-4 text-sm",
        variants[variant],
        className,
      )}
      {...p}
    />
  );
}

/** A boxed surface for a self-contained object (a form, a dialog body). */
export function Card({ className, children, title, action }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cn("rounded-2xl border border-border bg-surface p-4 shadow-[0_1px_3px_rgb(17_24_39/0.04)] sm:p-6", className)}>
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

const field = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted/70 focus:border-text";
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input className={cn(field, "h-10", className)} {...p} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={cn(field, "min-h-24 leading-relaxed", className)} {...p} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={cn(field, "h-10", className)} {...p} />;

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Badge({ children, className, color }: { children: ReactNode; className?: string; color?: string }) {
  return (
    <span
      className={cn("inline-flex items-center rounded-md bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-muted", className)}
      style={color ? { background: `${color}22`, color } : undefined}
    >
      {children}
    </span>
  );
}

/** Segmented control for switching views within a page. */
export function Tabs<T extends string>({ value, onChange, options, className, label }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("inline-flex gap-1 rounded-xl bg-surface-2 p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
            value === o.value ? "bg-surface font-semibold text-text shadow-[0_0_0_1px_var(--border)]" : "text-muted hover:text-text",
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
  // instead of showModal() moving focus to the close button.
  const [shown, setShown] = useState(false);
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    setShown(open);
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-border bg-surface p-0 text-text backdrop:bg-[#0d1020]/45 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close" className="-mr-2"><X size={18} /></Button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto px-5 pb-5 pt-2">{open && shown && children}</div>
    </dialog>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1.5 rounded-2xl border border-dashed border-border px-5 py-8">
      {icon && <div className="mb-1 text-muted">{icon}</div>}
      <p className="font-semibold">{title}</p>
      {children && <div className="max-w-prose text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Progress({ value, className, color }: { value: number; className?: string; color?: string }) {
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-2", className)}>
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-500"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }}
      />
    </div>
  );
}

export function PageHeader({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight md:text-[34px]">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {action}
    </header>
  );
}

export function Dots({ value, max = 5, onChange, label }: { value: number; max?: number; onChange?: (v: number) => void; label: string }) {
  return (
    // The dots stay small, but each sits in a 32px button so a thumb picks the one it means.
    // Negative margin keeps the row aligned with the text around it despite the larger buttons.
    <span className={cn("inline-flex", onChange && "-mx-2.5 -my-2.5")} role="radiogroup" aria-label={label}>
      {Array.from({ length: max }, (_, i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={value === i + 1}
          aria-label={`${label} ${i + 1}`}
          disabled={!onChange}
          onClick={() => onChange?.(i + 1)}
          className={cn("group grid place-items-center rounded-full", onChange ? "h-8 w-8" : "h-2.5 w-3.5")}
        >
          <span
            className={cn(
              "h-2.5 w-2.5 rounded-full transition-colors",
              i < value ? "bg-text" : "bg-surface-2 ring-1 ring-border ring-inset",
              onChange && "group-hover:ring-2 group-hover:ring-accent/40",
            )}
          />
        </button>
      ))}
    </span>
  );
}

/** Round tick used to mark a session or item done. */
export function Tick({ done, onClick, label }: { done: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={done}
      onClick={onClick}
      className={cn(
        "flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full border-2 transition-colors",
        done ? "border-good text-good" : "border-muted/40 hover:border-accent",
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
