"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { format } from "date-fns";
import { ArrowLeft, MessagesSquare, Plus, Search } from "lucide-react";
import { useState } from "react";
import { db } from "@/lib/db";
import { daysBetween, prettyDay } from "@/lib/dates";
import { useToday } from "@/lib/use-today";
import type { Chat } from "@/lib/types";
import { Button, Input, cn, subjectStyle } from "../ui";

const GROUPS = ["Today", "Yesterday", "Previous 7 days", "Older"] as const;
const groupOf = (age: number) => GROUPS[age <= 0 ? 0 : age === 1 ? 1 : age <= 7 ? 2 : 3];

/** Past conversations, newest first, grouped by when they were last used. */
export function ChatHistory({ selected, onOpen, onNew, onClose }: {
  selected: number | null;
  onOpen: (id: number) => void;
  onNew: () => void;
  onClose: () => void; // phones: back to the conversation
}) {
  const [query, setQuery] = useState("");
  const today = useToday();
  const data = useLiveQuery(async () => {
    const [chats, subjects] = await Promise.all([db.chats.orderBy("updatedAt").reverse().toArray(), db.subjects.toArray()]);
    return { chats, subjects: new Map(subjects.map((s) => [s.id!, s])) };
  });

  const q = query.trim().toLowerCase();
  const shown = (data?.chats ?? []).filter((c) => !q || c.title.toLowerCase().includes(q) || data?.subjects.get(c.subjectId)?.name.toLowerCase().includes(q));
  const grouped = new Map<string, Chat[]>();
  for (const c of shown) {
    const g = groupOf(daysBetween(format(new Date(c.updatedAt), "yyyy-MM-dd"), today));
    grouped.set(g, [...(grouped.get(g) ?? []), c]);
  }

  return (
    <div className="flex min-h-0 w-full flex-col rounded-xl border border-border bg-surface shadow-sheet">
      <div className="flex items-center gap-2 border-b border-border p-2.5">
        <Button variant="ghost" size="sm" className="md:hidden" onClick={onClose} aria-label="Back to the chat"><ArrowLeft size={16} /></Button>
        <span className="flex-1 px-1 text-[13px] font-semibold">History</span>
        <Button variant="secondary" size="sm" onClick={onNew}><Plus size={14} /> New</Button>
      </div>
      {(data?.chats.length ?? 0) > 4 && (
        <div className="relative border-b border-border p-2.5">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search chats" className="h-8 pl-8 text-[13px]" />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {!data ? null : !data.chats.length ? (
          <div className="flex flex-col items-start gap-1.5 px-3 py-6 text-sm text-muted">
            <MessagesSquare size={18} aria-hidden />
            Your conversations will be saved here, so you can come back to any answer before the exam.
          </div>
        ) : !shown.length ? (
          <p className="px-3 py-6 text-sm text-muted">No chats match &ldquo;{query}&rdquo;.</p>
        ) : (
          GROUPS.filter((g) => grouped.has(g)).map((g) => (
            <section key={g} className="mb-2">
              <h3 className="px-2.5 pb-1 pt-2 text-[11.5px] font-medium uppercase tracking-wide text-muted">{g}</h3>
              <ul className="space-y-px">
                {grouped.get(g)!.map((c) => {
                  const subject = data.subjects.get(c.subjectId);
                  const on = c.id === selected;
                  return (
                    <li key={c.id} style={subjectStyle(subject?.color)}>
                      <button
                        type="button"
                        onClick={() => onOpen(c.id!)}
                        aria-current={on ? "true" : undefined}
                        className={cn(
                          "press flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left",
                          on ? "bg-accent-soft" : "hover:bg-surface-2",
                        )}
                      >
                        <span className={cn("line-clamp-2 text-[13.5px] leading-snug", on ? "font-semibold text-accent" : "font-medium")}>{c.title}</span>
                        <span className="flex w-full min-w-0 items-center gap-1.5 text-[12px] text-muted">
                          <span aria-hidden className="subj-dot h-1.5 w-1.5 shrink-0 rounded-full" />
                          <span className="truncate">{subject?.name ?? "Subject"}</span>
                          <span aria-hidden>·</span>
                          <span className="shrink-0 tabular-nums">{g === "Today" ? format(new Date(c.updatedAt), "HH:mm") : prettyDay(format(new Date(c.updatedAt), "yyyy-MM-dd"))}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
