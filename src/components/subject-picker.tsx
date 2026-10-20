"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { SUBJECT_CATALOG, type CatalogSubject } from "@/lib/subject-catalog";
import { Input, cn } from "./ui";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+]+/g, " ").trim();

// The same subject appears under several programmes (e.g. DBMS in B.Tech and BCA); list it once.
const UNIQUE: CatalogSubject[] = Object.values(
  SUBJECT_CATALOG.reduce<Record<string, CatalogSubject>>((acc, s) => {
    const k = norm(s.name);
    acc[k] = acc[k] ? { ...acc[k], aliases: [...(acc[k].aliases ?? []), ...(s.aliases ?? [])] } : s;
    return acc;
  }, {}),
);

/** Ranks catalog subjects for a query: exact alias, then name prefix, then word prefix, then substring. */
function search(query: string, exclude: Set<string>): CatalogSubject[] {
  const q = norm(query);
  const pool = UNIQUE.filter((s) => !exclude.has(norm(s.name)));
  if (!q) return pool;
  const scored: [number, CatalogSubject][] = [];
  for (const s of pool) {
    const name = norm(s.name);
    const aliases = (s.aliases ?? []).map(norm);
    let score = -1;
    if (aliases.includes(q)) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.split(" ").some((w) => w.startsWith(q)) || aliases.some((a) => a.startsWith(q))) score = 2;
    else if (name.includes(q)) score = 3;
    if (score >= 0) scored.push([score, s]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).map(([, s]) => s);
}

/**
 * Subject name field with a searchable list of common subjects.
 * Free text still works: the student can type any name that isn't listed.
 */
export function SubjectPicker({ value, onChange, exclude = [], autoFocus }: {
  value: string;
  onChange: (name: string) => void;
  /** Names already added, hidden from the list. */
  exclude?: string[];
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Plain autoFocus fires before the parent <dialog> is shown, so focus lands on its close button.
  // Waiting a tick lets showModal() run first.
  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => {
      wrapRef.current?.querySelector("input")?.focus();
      setOpen(true);
    });
    return () => clearTimeout(t);
  }, [autoFocus]);
  const excluded = useMemo(() => new Set(exclude.map(norm)), [exclude]);
  const results = useMemo(() => search(value, excluded), [value, excluded]);
  const showing = open && results.length > 0;

  const pick = (s: CatalogSubject) => {
    onChange(s.name);
    setOpen(false);
  };

  const move = (i: number) => {
    setActive(i);
    listRef.current?.children[i]?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div ref={wrapRef} className="relative">
      <Input
        required
        value={value}
        placeholder="Search, e.g. DBMS or Operating Systems"
        role="combobox"
        aria-expanded={showing}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showing ? `${listId}-${active}` : undefined}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) setOpen(true);
            else move(Math.min(active + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            move(Math.max(active - 1, 0));
          } else if (e.key === "Enter" && showing && results[active]) {
            // Only take over Enter while the list is open; otherwise it submits the form as usual.
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === "Escape" && showing) {
            e.preventDefault();
            e.stopPropagation(); // keep the dialog open
            setOpen(false);
          }
        }}
      />
      {showing && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Subjects"
          // In flow rather than floating: the dialog body scrolls, which would clip an absolute dropdown.
          className="mt-1.5 max-h-64 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-sm"
        >
          {results.map((s, i) => (
            <li
              key={s.name}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, not click, so the pick lands before the input's blur closes the list
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex cursor-pointer items-baseline justify-between gap-3 rounded-lg px-3 py-2 text-sm",
                i === active ? "bg-accent-soft text-accent" : "text-text",
              )}
            >
              <span className="min-w-0 truncate font-medium">{s.name}</span>
              <span className={cn("shrink-0 text-xs", i === active ? "text-accent/80" : "text-muted")}>{s.programme}</span>
            </li>
          ))}
        </ul>
      )}
      {open && value.trim() && results.length === 0 && (
        <p className="mt-1.5 text-xs text-muted">Not in the list. It will be added as you typed it.</p>
      )}
    </div>
  );
}
