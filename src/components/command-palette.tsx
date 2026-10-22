"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeftRight, BarChart3, BookOpen, CalendarDays, CornerDownLeft, GraduationCap, House, RefreshCw, RotateCcw, Search, Settings } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { db } from "@/lib/db";
import { daysBetween, prettyDay, today } from "@/lib/dates";
import { MATCH_THRESHOLD, subjectScore, type SubjectRef } from "@/lib/drive/classify";
import { examTypeLabel } from "@/lib/exams";
import { examInMode, modeShort, otherMode, setExamMode, useExamMode } from "@/lib/mode";
import { replan } from "@/lib/replan";
import { OPEN_EVENT } from "./command-palette-loader";
import { toast } from "./toast";
import { cn } from "./ui";

interface Command {
  id: string;
  group: "Go to" | "Subjects" | "Exams" | "Actions";
  label: string;
  hint?: string;
  icon: ReactNode;
  /** Extra words to match, e.g. a course code. */
  keywords?: string;
  /** Also matched the way subjects are recognised elsewhere, so "dbms" finds Database Management Systems. */
  subject?: SubjectRef;
  run: () => void | Promise<void>;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Ctrl/Cmd+K search: jump to any page, subject or exam, or run a common action. */
export function CommandPalette({ initialOpen = false }: { initialOpen?: boolean }) {
  const router = useRouter();
  const mode = useExamMode();
  const [open, setOpen] = useState(initialOpen);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const data = useLiveQuery(async () => {
    const [subjects, exams] = await Promise.all([db.subjects.orderBy("name").toArray(), db.exams.where("date").aboveOrEqual(today()).sortBy("date")]);
    return { subjects, exams };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useLayoutEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setQuery("");
      setActive(0);
      input.current?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => router.push(href);
    const t = today();
    const list: Command[] = [
      { id: "p-today", group: "Go to", label: "Today", icon: <House size={17} />, run: go("/") },
      { id: "p-planner", group: "Go to", label: "Planner", icon: <CalendarDays size={17} />, keywords: "plan schedule week", run: go("/planner") },
      { id: "p-subjects", group: "Go to", label: "Subjects", icon: <BookOpen size={17} />, keywords: "syllabus notes", run: go("/subjects") },
      { id: "p-exams", group: "Go to", label: "Exams", icon: <GraduationCap size={17} />, keywords: "date sheet", run: go("/exams") },
      { id: "p-revise", group: "Go to", label: "Revise", icon: <RotateCcw size={17} />, keywords: "revision due", run: go("/revise") },
      { id: "p-progress", group: "Go to", label: "Progress", icon: <BarChart3 size={17} />, keywords: "stats charts", run: go("/progress") },
      { id: "p-settings", group: "Go to", label: "Settings", icon: <Settings size={17} />, keywords: "backup reminders", run: go("/settings") },
    ];
    for (const s of data?.subjects ?? []) {
      list.push({
        id: `s-${s.id}`,
        group: "Subjects",
        label: s.name,
        hint: s.code,
        keywords: s.code,
        subject: { id: s.id!, name: s.name, code: s.code },
        icon: <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />,
        run: go(`/subjects/view?id=${s.id}`),
      });
    }
    const subjectName = new Map((data?.subjects ?? []).map((s) => [s.id, s.name]));
    const subjectRef = new Map((data?.subjects ?? []).map((s) => [s.id, { id: s.id!, name: s.name, code: s.code }]));
    for (const e of (data?.exams ?? []).filter((x) => examInMode(x, mode))) {
      const d = daysBetween(t, e.date);
      list.push({
        id: `e-${e.id}`,
        group: "Exams",
        label: `${subjectName.get(e.subjectId) ?? "Exam"} ${examTypeLabel(e.type).toLowerCase()}`,
        hint: d === 0 ? "today" : `${prettyDay(e.date)}, in ${d}d`,
        keywords: "kit exam day",
        subject: subjectRef.get(e.subjectId),
        icon: <GraduationCap size={17} />,
        run: go(`/exams/view?id=${e.id}`),
      });
    }
    list.push({
      id: "a-replan",
      group: "Actions",
      label: "Rebalance study plan",
      keywords: "replan generate missed",
      icon: <RefreshCw size={17} />,
      run: async () => {
        toast("Rebalancing your plan…");
        try {
          const res = await replan();
          toast(`Plan updated: ${res.sessions.length} sessions scheduled`);
        } catch (err) {
          toast(err instanceof Error ? err.message : "Could not rebalance the plan");
        }
      },
    });
    if (mode) {
      const next = otherMode(mode);
      list.push({
        id: "a-mode",
        group: "Actions",
        label: `Switch to ${modeShort(next).toLowerCase()} mode`,
        keywords: "mid sem major end term mode",
        icon: <ArrowLeftRight size={17} />,
        run: async () => {
          await setExamMode(next);
          toast(`Switched to ${modeShort(next).toLowerCase()} mode`);
        },
      });
    }
    return list;
  }, [data, mode, router]);

  const results = useMemo(() => {
    const q = norm(query);
    if (!q) return commands;
    return commands.filter(
      (c) => norm(`${c.label} ${c.keywords ?? ""} ${c.group}`).includes(q) || (!!c.subject && subjectScore(q, c.subject) >= MATCH_THRESHOLD),
    );
  }, [commands, query]);

  const run = useCallback((c: Command) => {
    setOpen(false);
    void c.run();
  }, []);

  const move = (i: number) => {
    setActive(i);
    listRef.current?.querySelector(`[data-index="${i}"]`)?.scrollIntoView({ block: "nearest" });
  };

  let lastGroup = "";
  return (
    <dialog
      ref={dialog}
      onClose={() => setOpen(false)}
      onClick={(e) => e.target === dialog.current && setOpen(false)}
      aria-label="Search"
      className="palette-in mx-auto mt-[12vh] w-[calc(100%-2rem)] max-w-xl overflow-hidden rounded-2xl border border-border bg-surface p-0 text-text shadow-2xl backdrop:bg-[#0d1020]/40 backdrop:backdrop-blur-[2px]"
    >
      <div className="flex items-center gap-3 border-b border-border px-4">
        <Search size={18} className="shrink-0 text-muted" aria-hidden />
        <input
          ref={input}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); move(Math.min(active + 1, results.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); move(Math.max(active - 1, 0)); }
            else if (e.key === "Enter" && results[active]) { e.preventDefault(); run(results[active]); }
          }}
          placeholder="Search subjects, exams and pages"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={results[active] ? `${listId}-${results[active].id}` : undefined}
          autoComplete="off"
          // The open palette already shows where focus is, so the global focus ring would only box in the field.
          className="h-14 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted/70 focus-visible:outline-none"
        />
        <kbd className="hidden rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted sm:block">Esc</kbd>
      </div>
      <ul ref={listRef} id={listId} role="listbox" aria-label="Results" className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
        {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Nothing matches &ldquo;{query}&rdquo;.</li>}
        {results.map((c, i) => {
          const heading = c.group !== lastGroup ? c.group : null;
          lastGroup = c.group;
          return (
            <li key={c.id} role="presentation">
              {heading && <p className="px-3 pb-1 pt-3 text-xs font-semibold text-muted first:pt-1">{heading}</p>}
              <div
                id={`${listId}-${c.id}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                onMouseMove={() => active !== i && setActive(i)}
                onClick={() => run(c)}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-[15px]",
                  i === active ? "bg-accent-soft text-accent" : "text-text",
                )}
              >
                <span className={cn("flex w-5 shrink-0 justify-center", i === active ? "text-accent" : "text-muted")}>{c.icon}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{c.label}</span>
                {c.hint && <span className={cn("shrink-0 text-xs", i === active ? "text-accent/80" : "text-muted")}>{c.hint}</span>}
                {i === active && <CornerDownLeft size={14} className="shrink-0 text-accent/70" aria-hidden />}
              </div>
            </li>
          );
        })}
      </ul>
    </dialog>
  );
}
