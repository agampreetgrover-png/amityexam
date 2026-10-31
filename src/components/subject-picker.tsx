"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Course } from "@/lib/drive/catalog";
import { sameSubject } from "@/lib/drive/classify";
import { SUBJECT_CATALOG, type CatalogSubject } from "@/lib/subject-catalog";
import { Badge, Input, cn } from "./ui";

const plain = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9+]+/g, " ").trim(); // keeps "+" (C++)
/** Compares subject names ignoring case and punctuation, with every name of one subject ("Design and Analysis of Algorithms") as one. */
export const subjectKey = (s: string) => sameSubject(plain(s));
const norm = subjectKey;

// The same subject appears under several programmes (e.g. DBMS in B.Tech and BCA); list it once.
const UNIQUE: CatalogSubject[] = Object.values(
  SUBJECT_CATALOG.reduce<Record<string, CatalogSubject>>((acc, s) => {
    const k = norm(s.name);
    acc[k] = acc[k] ? { ...acc[k], aliases: [...(acc[k].aliases ?? []), ...(s.aliases ?? [])] } : s;
    return acc;
  }, {}),
);

/**
 * The student's own courses come first, labelled with their code; the generic list fills in
 * anything their library doesn't have. A generic entry with the same name as a course is dropped.
 */
type Entry = CatalogSubject & { own?: boolean };

// A generic entry's short forms, plus its name when it's the subject's other name ("design and analysis" still finds it).
const aliasesOf = (g: CatalogSubject | undefined, name: string) =>
  g ? [...(g.aliases ?? []), ...(plain(g.name) !== plain(name) ? [g.name] : [])] : [];

function buildPool(courses: Course[]): Entry[] {
  const generic = new Map(UNIQUE.map((s) => [norm(s.name), s]));
  // A course keeps the generic entry's short forms, so "dbms" still finds the student's own DBMS course.
  const own = courses.map((c) => ({ name: c.name, programme: c.code, aliases: [c.code, ...aliasesOf(generic.get(norm(c.name)), c.name)], own: true }));
  const ownNames = new Set(own.map((c) => norm(c.name)));
  return [...own, ...UNIQUE.filter((s) => !ownNames.has(norm(s.name)))];
}

/** Ranks subjects for a query: exact alias, then name prefix, then word prefix, then substring. */
function search(query: string, all: Entry[], exclude: Set<string>): Entry[] {
  const q = plain(query);
  const pool = all.filter((s) => !exclude.has(norm(s.name)));
  if (!q) return pool;
  const scored: [number, Entry][] = [];
  for (const s of pool) {
    const name = plain(s.name);
    const aliases = (s.aliases ?? []).map(plain);
    let score = -1;
    if (aliases.includes(q)) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.split(" ").some((w) => w.startsWith(q)) || aliases.some((a) => a.startsWith(q))) score = 2;
    else if (name.includes(q)) score = 3;
    if (score >= 0) scored.push([score, s]);
  }
  // Within a score, the student's own courses come before generic ones.
  return scored.sort((a, b) => a[0] - b[0] || Number(!!b[1].own) - Number(!!a[1].own) || a[1].name.localeCompare(b[1].name)).map(([, s]) => s);
}

/**
 * Subject name field with a searchable list of common subjects.
 * Free text still works: the student can type any name that isn't listed.
 */
export function SubjectPicker({ value, onChange, exclude = [], courses = [], autoFocus }: {
  value: string;
  onChange: (name: string) => void;
  /** Names already added, hidden from the list. */
  exclude?: string[];
  /** The student's own courses from their Drive library, listed first. */
  courses?: Course[];
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pointerDown = useRef(false);
  useEffect(() => {
    const down = () => {
      pointerDown.current = true;
    };
    const up = () => {
      setTimeout(() => {
        pointerDown.current = false;
      });
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
    };
  }, []);
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
  const pool = useMemo(() => buildPool(courses), [courses]);
  const results = useMemo(() => search(value, pool, excluded), [value, pool, excluded]);
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
        onBlur={() => {
          // A mouse click elsewhere blurs the input on mousedown. Closing the list right then shifts the form
          // up under the pointer, so the click lands on the wrong element (e.g. misses Save). Close once it lands.
          if (!pointerDown.current) return setOpen(false);
          document.addEventListener("click", () => {
            if (!wrapRef.current?.contains(document.activeElement)) setOpen(false);
          }, { once: true });
        }}
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
          className="mt-1.5 max-h-64 overflow-y-auto rounded-xl border border-border bg-surface p-1"
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
                "flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 text-sm text-text transition-colors duration-150",
                i === active && "bg-surface-2",
              )}
            >
              <span className="min-w-0 truncate font-medium">{s.name}</span>
              {s.programme && <Badge tone={s.own ? "accent" : "neutral"} className="shrink-0">{s.programme}</Badge>}
            </li>
          ))}
        </ul>
      )}
      {value.trim() && results.length === 0 && (
        <p className="mt-1.5 text-xs text-muted">Not in the list. It will be added as you typed it.</p>
      )}
    </div>
  );
}
