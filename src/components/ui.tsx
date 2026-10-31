"use client";

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { MoreHorizontal, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type RefObject, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { urgency } from "@/lib/exams";
import type { Topic, Unit } from "@/lib/types";

export const cn = (...c: ClassValue[]) => twMerge(clsx(c));

/** Sets a subject's colour for the .subj-* classes in globals.css on this element and its children. */
export const subjectStyle = (color?: string) => (color ? ({ "--subj": color } as CSSProperties) : undefined);

type Variant = "primary" | "secondary" | "ghost" | "danger";
const variants: Record<Variant, string> = {
  // A faint top highlight and a hairline shadow give the primary a pressed-ink feel without a gradient.
  // Disabled, it goes neutral rather than a faded indigo, which read as a muddy violet block on dark.
  primary: "bg-accent-solid text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.14),var(--shadow-control)] hover:bg-accent-solid-hover disabled:bg-surface-3 disabled:text-faint disabled:opacity-100 disabled:shadow-none",
  secondary: "border border-border bg-surface text-text shadow-control hover:border-line-strong hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-text",
  danger: "text-muted hover:bg-bad/10 hover:text-bad",
};
// On touch screens an invisible ring widens the 32px sizes to 40px, so a row of them stays compact but tappable.
const touchRing = "relative pointer-coarse:before:absolute pointer-coarse:before:-inset-1 pointer-coarse:before:content-['']";
const sizes = {
  sm: `h-8 px-2.5 text-[13px] ${touchRing}`,
  md: "h-9 px-3.5 text-sm",
  // Square, for a lone icon; give it an aria-label.
  icon: `h-8 w-8 px-0 ${touchRing}`,
};

/** A Button's classes, for a Link that should look like one. Client components only: this file is "use client". */
export const buttonClass = (variant: Variant = "primary", size: keyof typeof sizes = "md", className?: string) =>
  cn(
    "press inline-flex select-none items-center justify-center gap-1.5 rounded-lg font-medium disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0",
    sizes[size],
    variants[variant],
    className,
  );

export function Button({ variant = "primary", size = "md", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof sizes }) {
  return <button className={buttonClass(variant, size, className)} {...p} />;
}

/** A white card with a padded body: a form, a tool, a self-contained object. */
export function Card({ className, children, title, action }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cn("rounded-2xl border border-border bg-surface p-5 shadow-sheet sm:p-6", className)}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-[15px] font-bold tracking-[-0.01em]">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** A white card with no padding, for a table or a list of rows that run edge to edge. */
export function Panel({ className, children, as: Tag = "div" }: { className?: string; children: ReactNode; as?: "div" | "ul" | "section" }) {
  return <Tag className={cn("overflow-hidden rounded-2xl border border-border bg-surface shadow-sheet", className)}>{children}</Tag>;
}

/** Column headings over a Panel's rows: small, quiet, ruled off from the rows. */
export const tableHead = "border-b border-border bg-surface-2/60 text-[12px] font-medium text-muted";

/** An unboxed page section: a heading and its content, separated by whitespace rather than borders. */
export function Section({ className, children, title, action }: { className?: string; children: ReactNode; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cn("py-1", className)}>
      {(title || action) && (
        <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
          {title && <h2 className="text-[15px] font-bold tracking-[-0.01em]">{title}</h2>}
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

// Focus shows as the indigo border plus a soft ring, so the global outline is switched off for fields.
// Touch screens get 16px text: iOS zooms the whole page into any field set smaller when it takes focus.
const field =
  "w-full rounded-lg border border-line-control bg-surface px-3 py-2 text-sm text-text shadow-control transition-[border-color,box-shadow] duration-150 placeholder:text-faint pointer-coarse:text-base hover:border-faint focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_18%,transparent)] focus-visible:outline-none disabled:opacity-60 aria-[invalid=true]:border-bad";
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

/** Badge tones: quiet tinted fills with a hairline of the same hue. Status tones always sit beside words, never alone. */
const badgeTones = {
  neutral: "border-border bg-surface-2 text-muted",
  accent: "border-accent/20 bg-accent/10 text-accent",
  good: "border-good/20 bg-good/10 text-good",
  warn: "border-mark/25 bg-mark-soft text-mark-ink",
  critical: "border-critical/25 bg-critical-soft text-critical",
};
export type BadgeTone = keyof typeof badgeTones;

/** A small label for metadata (a code, a count, a status) so it scans as a token rather than grey text. */
export function Badge({ children, className, tone = "neutral" }: { children: ReactNode; className?: string; tone?: BadgeTone }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums [&_svg]:size-3 [&_svg]:shrink-0", badgeTones[tone], className)}>
      {children}
    </span>
  );
}

/** The badge tone for an exam this many days away: coral under a week, amber under two weeks. */
export const daysTone = (days: number): BadgeTone => ({ critical: "critical", soon: "warn", later: "neutral", past: "neutral" } as const)[urgency(days)];

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
export function Tabs<T extends string>({ value, onChange, options, className, label, idBase }: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
  label: string;
  idBase?: string; // links each tab to its panel: give the panel tabPanelProps(idBase, value)
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const { box: bar, ready } = useSlider(wrap, '[aria-selected="true"]', [value, options.length]);
  // Inside a sideways scroller (TabScroller on phones), keep the chosen tab in view, even when opened by link.
  useEffect(() => {
    const on = wrap.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    const sc = wrap.current?.parentElement;
    if (!on || !sc || sc.scrollWidth <= sc.clientWidth) return;
    const a = on.getBoundingClientRect();
    const b = sc.getBoundingClientRect();
    const by = a.left < b.left + 24 ? a.left - b.left - 24 : a.right > b.right - 24 ? a.right - b.right + 24 : 0;
    if (by) sc.scrollBy({ left: by, behavior: ready ? "smooth" : "instant" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  // One Tab stop for the row; the arrow keys (and Home/End) move between tabs, as screen-reader users expect.
  const onKey = (e: KeyboardEvent) => {
    const i = options.findIndex((o) => o.value === value);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: options.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = options[(to + options.length) % options.length];
    onChange(next.value);
    wrap.current?.querySelectorAll<HTMLElement>('[role="tab"]')[options.indexOf(next)]?.focus();
  };
  return (
    <div ref={wrap} role="tablist" aria-label={label} onKeyDown={onKey} className={cn("relative flex gap-1 border-b border-border", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          id={idBase && `${idBase}-tab-${o.value}`}
          aria-controls={idBase && value === o.value ? `${idBase}-panel-${o.value}` : undefined}
          aria-selected={value === o.value}
          tabIndex={value === o.value ? 0 : -1}
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

/** Spread on the element showing a Tabs option's content, with the same idBase. */
export const tabPanelProps = (idBase: string, value: string) => ({ id: `${idBase}-panel-${value}`, role: "tabpanel", "aria-labelledby": `${idBase}-tab-${value}` });

/** A row that scrolls sideways when it doesn't fit, fading at whichever edge has more to show. */
export function TabScroller({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setMore({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      ro.disconnect();
    };
  }, []);
  const mask = `linear-gradient(to right, ${more.left ? "transparent, #000 3rem" : "#000"}, ${more.right ? "#000 calc(100% - 3.5rem), transparent" : "#000"})`;
  return (
    <div ref={ref} className={cn("overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)} style={{ maskImage: mask, WebkitMaskImage: mask }}>
      {children}
    </div>
  );
}

/** A compact either/or switch: a slate track with a white pill that slides under the chosen option. */
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
  const i = options.findIndex((o) => o.value === value);
  // One Tab stop for the group; the arrow keys (and Home/End) move the choice, as a radio group should.
  const onKey = (e: KeyboardEvent) => {
    const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: options.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const n = (to + options.length) % options.length;
    if (options[n].value !== value) onChange(options[n].value);
    wrap.current?.querySelectorAll<HTMLElement>('[role="radio"]')[n]?.focus();
  };
  return (
    <div ref={wrap} role="radiogroup" aria-label={label} onKeyDown={onKey} className={cn("relative inline-flex rounded-xl bg-surface-2 p-1", className)}>
      {box && (
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-1 left-0 rounded-lg bg-surface shadow-[0_1px_2px_var(--lift-shade),0_0_0_1px_var(--line-control)]",
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
          // Falls back to the first option if the value matches none, so the group never drops out of the Tab order.
          tabIndex={value === o.value || (i < 0 && o === options[0]) ? 0 : -1}
          title={o.title}
          onClick={() => value !== o.value && onChange(o.value)}
          className={cn(
            "relative z-10 inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors duration-150",
            // One step taller on touch screens, where 28px is a small target for a thumb.
            size === "sm" ? "h-7 px-2.5 text-[13px] pointer-coarse:h-8" : "h-8 px-3.5 text-sm pointer-coarse:h-9",
            value === o.value ? "font-semibold text-text" : "text-muted hover:text-text",
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
  const titleId = useId();
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
      aria-labelledby={titleId}
      className="sheet m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-border bg-surface p-0 text-text shadow-float"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5 sm:px-6">
        <h2 id={titleId} className="min-w-0 truncate text-[16px] font-semibold tracking-[-0.01em]">{title}</h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="-mr-1.5"><X size={18} /></Button>
      </div>
      {/* dvh: the visible height, so the buttons at the foot stay reachable with the phone's keyboard and browser bars up. */}
      <div className="max-h-[75dvh] overflow-y-auto px-5 pb-6 pt-5 sm:px-6">{shown && children}</div>
    </dialog>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1.5 rounded-2xl border border-dashed border-line-strong px-6 py-8">
      {icon && (
        <div className="mb-2 grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent [&_svg]:h-[18px] [&_svg]:w-[18px]">
          {icon}
        </div>
      )}
      <p className="font-semibold tracking-[-0.01em]">{title}</p>
      {children && <div className="max-w-prose text-sm leading-relaxed text-muted">{children}</div>}
    </div>
  );
}

/** A 6px progress bar on a visible track. Emerald by default: it measures how far along something is. */
export function Progress({ value, className, label }: { value: number; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-track", className)}
      {...(label ? { role: "progressbar", "aria-label": label, "aria-valuenow": Math.round(v), "aria-valuemin": 0, "aria-valuemax": 100 } : { "aria-hidden": true })}
    >
      <div className="h-full rounded-full bg-mastery transition-[width] duration-500 ease-snappy" style={{ width: `${v}%` }} />
    </div>
  );
}

/**
 * Syllabus coverage as a two-tone bar: revised topics in the subject's full colour, then studied ones in a paler
 * band at half their share, so the bar ends where coverage() puts it. Sits inside an element that sets --subj.
 */
export function CoverageBar({ topics, className }: { topics: Pick<Topic, "status">[]; className?: string }) {
  const n = topics.length || 1;
  const revised = (topics.filter((t) => t.status === "revised").length / n) * 100;
  const studied = (topics.filter((t) => t.status === "studied").length / n) * 50; // counts half, as in coverage()
  return (
    <div className={cn("flex h-1.5 w-full overflow-hidden rounded-full bg-track", className)} aria-hidden>
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
        // min-w-0 lets a big unit shrink to its share instead of pushing the strip past a phone's edge.
        <div key={i} className="flex h-full min-w-0 gap-px overflow-hidden sm:gap-[2px]" style={{ flexGrow: g.length, flexBasis: 0 }}>
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
        // On touch screens an invisible ring widens the target to ~42px without changing how it looks.
        "relative flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors duration-150 pointer-coarse:before:absolute pointer-coarse:before:-inset-2.5 pointer-coarse:before:content-['']",
        done ? "border-mastery bg-mastery text-surface" : "border-faint hover:border-accent",
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

type MenuItem = { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean };

/**
 * A "⋯" button with a short list of actions. The list opens in the top layer (a popover), so a scrolling list
 * can't clip it, and Escape or a click elsewhere closes it. It opens below the button, or above when there's
 * no room, and keeps inside the window. Arrow keys move between the actions.
 */
export function Menu({ label, items, className }: { label: string; items: MenuItem[]; className?: string }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState !== "open" || !button.current) return;
      const b = button.current.getBoundingClientRect();
      const { width, height } = el.getBoundingClientRect();
      const below = b.bottom + 4 + height <= window.innerHeight - 8;
      el.style.top = `${below ? b.bottom + 4 : Math.max(8, b.top - 4 - height)}px`;
      el.style.left = `${Math.max(8, Math.min(b.right - width, window.innerWidth - width - 8))}px`;
      el.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    };
    el.addEventListener("toggle", onToggle);
    return () => el.removeEventListener("toggle", onToggle);
  }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const all = [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = all.indexOf(document.activeElement as HTMLElement);
    all[(at + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        popoverTarget={id}
        aria-label={label}
        aria-haspopup="menu"
        title={label}
        className={cn(
          "relative grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-text pointer-coarse:before:absolute pointer-coarse:before:-inset-2 pointer-coarse:before:content-['']",
          className,
        )}
      >
        <MoreHorizontal size={16} aria-hidden />
      </button>
      <div
        ref={list}
        id={id}
        popover="auto"
        role="menu"
        aria-label={label}
        onKeyDown={onKeyDown}
        // Fixed and placed on open (see above); the browser's default popover centring is switched off.
        className="fixed inset-auto m-0 w-44 rounded-lg border border-border bg-surface p-1 text-text shadow-float"
      >
        {items.map((it) => (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            onClick={() => {
              list.current?.hidePopover();
              it.onSelect();
            }}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13.5px] focus-visible:-outline-offset-2 pointer-coarse:py-2.5 [&_svg]:shrink-0",
              it.danger ? "text-bad hover:bg-bad/10 focus-visible:bg-bad/10" : "hover:bg-surface-2 focus-visible:bg-surface-2",
            )}
          >
            {it.icon}
            {it.label}
          </button>
        ))}
      </div>
    </>
  );
}

/** An on/off switch. The caller names it with labelledBy, since its label sits elsewhere in the row. */
export function Switch({ checked, onChange, disabled, labelledBy, describedBy }: {
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
  labelledBy: string;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        // A 24px switch; on touch screens an invisible ring makes it a thumb-sized target.
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:before:absolute pointer-coarse:before:-inset-2.5 pointer-coarse:before:content-['']",
        checked ? "bg-accent-solid enabled:hover:bg-accent-solid-hover" : "bg-surface-3 ring-1 ring-inset ring-line-control enabled:hover:bg-line-strong",
      )}
    >
      <span
        aria-hidden
        className={cn("h-[18px] w-[18px] rounded-full bg-accent-ink shadow-control transition-transform duration-150 ease-snappy", checked ? "translate-x-[19px]" : "translate-x-[3px]")}
      />
    </button>
  );
}
