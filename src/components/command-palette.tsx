"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDown, ArrowLeftRight, ArrowUp, BookOpen, CornerDownLeft, Flame, GraduationCap, House, MessagesSquare, Search, Settings, Sprout } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { db } from "@/lib/db";
import { daysBetween, prettyDay } from "@/lib/dates";
import { MATCH_THRESHOLD, subjectScore, type SubjectRef } from "@/lib/drive/classify";
import { byWhen, examTypeLabel } from "@/lib/exams";
import { examInMode, modeShort, otherMode, setExamMode, useExamMode } from "@/lib/mode";
import { useToday } from "@/lib/use-today";
import { OPEN_EVENT } from "./command-palette-loader";
import { toast } from "./toast";
import { Badge, cn, daysTone, subjectStyle, type BadgeTone } from "./ui";

interface Command {
  id: string;
  group: "Go to" | "Subjects" | "Exams" | "Actions";
  label: string;
  hint?: string;
  /** The hint's badge tone: an exam's is coral or amber as it gets close. */
  hintTone?: BadgeTone;
  icon: ReactNode;
  /** Extra words to match, e.g. a course code. */
  keywords?: string;
  /** Also matched the way subjects are recognised elsewhere, so "dbms" finds Database Management Systems. */
  subject?: SubjectRef;
  run: () => void | Promise<void>;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** The part of a label the query matched, in the selection tint. A row found by a keyword or a short form shows plain. */
function Matched({ text, query }: { text: string; query: string }) {
  const q = norm(query);
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[3px] bg-[var(--selection)] text-inherit">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}

const kbd = "inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-surface-2 px-1 font-sans text-[11px] font-medium text-muted ring-1 ring-inset ring-border";

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

  // The palette stays mounted all session, so "today" has to move on by itself.
  const t = useToday();
  const data = useLiveQuery(async () => {
    const [subjects, exams] = await Promise.all([db.subjects.orderBy("name").toArray(), db.exams.where("date").aboveOrEqual(t).toArray().then((es) => es.sort(byWhen))]);
    return { subjects, exams };
  }, [t]);

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
    const list: Command[] = [
      { id: "p-today", group: "Go to", label: "Today", icon: <House size={16} />, run: go("/") },
      { id: "p-subjects", group: "Go to", label: "Subjects", icon: <BookOpen size={16} />, keywords: "syllabus notes", run: go("/subjects") },
      { id: "p-chat", group: "Go to", label: "Chat", icon: <MessagesSquare size={16} />, keywords: "ask doubt pyq notes history", run: go("/chat") },
      { id: "p-important", group: "Go to", label: "Important", icon: <Flame size={16} />, keywords: "topics most asked pyq", run: go("/important") },
      { id: "p-zero-prep", group: "Go to", label: "Zero prep", icon: <Sprout size={16} />, keywords: "last minute cram", run: go("/zero-prep") },
      { id: "p-exams", group: "Go to", label: "Exams", icon: <GraduationCap size={16} />, keywords: "date sheet", run: go("/exams") },
      { id: "p-settings", group: "Go to", label: "Settings", icon: <Settings size={16} />, keywords: "backup reminders", run: go("/settings") },
    ];
    for (const s of data?.subjects ?? []) {
      list.push({
        id: `s-${s.id}`,
        group: "Subjects",
        label: s.name,
        hint: s.code,
        keywords: s.code,
        subject: { id: s.id!, name: s.name, code: s.code },
        icon: <span className="subj-dot h-2.5 w-2.5 rounded-full" style={subjectStyle(s.color)} />,
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
        hint: d === 0 ? "Today" : `${prettyDay(e.date)}, in ${d}d`,
        hintTone: daysTone(d),
        keywords: "kit exam day",
        subject: subjectRef.get(e.subjectId),
        icon: <GraduationCap size={16} />,
        run: go(`/exams/view?id=${e.id}`),
      });
    }
    if (mode) {
      const next = otherMode(mode);
      list.push({
        id: "a-mode",
        group: "Actions",
        label: `Switch to ${modeShort(next).toLowerCase()} mode`,
        keywords: "mid sem major end term mode",
        icon: <ArrowLeftRight size={16} />,
        run: async () => {
          await setExamMode(next);
          toast(`Switched to ${modeShort(next).toLowerCase()} mode`);
        },
      });
    }
    return list;
  }, [data, mode, router, t]);

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
      // Phones: a near-full-width sheet just under the top edge, so the results stay above the keyboard. Wider: lower down.
      className="palette-in mx-auto mt-[max(0.75rem,env(safe-area-inset-top))] w-[calc(100%-1.5rem)] max-w-xl overflow-hidden rounded-2xl border border-border bg-surface p-0 text-text shadow-float backdrop:bg-[var(--scrim)] sm:mt-[12vh] sm:w-[calc(100%-2rem)]"
    >
      <div className="flex items-center gap-3 border-b border-border pl-4 pr-2 sm:px-5">
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
          className="h-14 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint focus-visible:outline-none"
        />
        <kbd className={cn(kbd, "hidden px-1.5 sm:inline-flex")}>Esc</kbd>
        {/* Phones have no Esc key. Tapping the backdrop closes too, but a word is easier to find. */}
        <button type="button" onClick={() => setOpen(false)} className="press h-10 shrink-0 rounded-lg px-2.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-text sm:hidden">
          Cancel
        </button>
      </div>
      <ul ref={listRef} id={listId} role="listbox" aria-label="Results" className="max-h-[min(60dvh,420px)] overflow-y-auto overscroll-contain p-1.5">
        {results.length === 0 && (
          <li className="px-3 py-6 text-sm">
            <p className="font-medium">Nothing matches &ldquo;{query}&rdquo;</p>
            <p className="mt-1 text-muted">Try a subject&apos;s name or course code, or a page such as Exams.</p>
          </li>
        )}
        {results.map((c, i) => {
          const heading = c.group !== lastGroup ? c.group : null;
          lastGroup = c.group;
          // Headings inside a listbox aren't read out, so each option points at its group's heading.
          const groupId = `${listId}-g-${c.group.replace(/\s+/g, "-")}`;
          return (
            <li key={c.id} role="presentation">
              {heading && <p id={groupId} className="px-3 pb-1.5 pt-3 text-[12px] font-medium text-faint">{heading}</p>}
              <div
                id={`${listId}-${c.id}`}
                data-index={i}
                role="option"
                aria-describedby={groupId}
                aria-selected={i === active}
                onMouseMove={() => active !== i && setActive(i)}
                onClick={() => run(c)}
                className={cn(
                  "relative flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] transition-colors duration-100",
                  // The active row: a quiet fill, inset from the palette's edges, with its icon in the accent.
                  i === active && "bg-surface-2 active:bg-surface-3",
                )}
              >
                <span className={cn("flex w-5 shrink-0 justify-center transition-colors duration-100", i === active ? "text-accent" : "text-muted")}>{c.icon}</span>
                {/* A long subject name takes a second line on a phone instead of losing its end to the date badge. */}
                <span className="line-clamp-2 min-w-0 flex-1 font-medium sm:line-clamp-1"><Matched text={c.label} query={query} /></span>
                {c.hint && <Badge tone={c.hintTone} className="shrink-0">{c.hint}</Badge>}
                {/* Return opens the active row. The mark keeps its space on every row so badges don't shift as it moves,
                    and touch screens, with no Return key, don't show it. */}
                <CornerDownLeft size={14} className={cn("shrink-0 text-muted pointer-coarse:hidden", i !== active && "invisible")} aria-hidden />
              </div>
            </li>
          );
        })}
      </ul>
      {/* How to drive it from a keyboard, on screens that have one. */}
      <div aria-hidden className="hidden items-center gap-4 border-t border-border px-5 py-2 text-[12px] text-muted pointer-fine:sm:flex">
        <span className="flex items-center gap-1.5"><kbd className={kbd}><ArrowUp size={11} /></kbd><kbd className={kbd}><ArrowDown size={11} /></kbd> to move</span>
        <span className="flex items-center gap-1.5"><kbd className={kbd}><CornerDownLeft size={11} /></kbd> to open</span>
      </div>
      {/* Always mounted, so a screen reader hears the count change as the query is typed. */}
      <p role="status" className="sr-only">{query ? (results.length ? `${results.length} result${results.length === 1 ? "" : "s"}` : "No results") : ""}</p>
    </dialog>
  );
}
