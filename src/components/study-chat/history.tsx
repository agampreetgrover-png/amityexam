"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { format, formatDistanceToNowStrict } from "date-fns";
import { ArrowLeft, Copy, MessagesSquare, PanelLeftClose, Pencil, Pin, PinOff, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { db, deleteChat } from "@/lib/db";
import { daysBetween } from "@/lib/dates";
import { useToday } from "@/lib/use-today";
import type { Chat } from "@/lib/types";
import { toast } from "../toast";
import { Badge, Button, Input, Menu, cn, subjectStyle } from "../ui";

const GROUPS = ["Pinned", "Today", "Yesterday", "Previous 7 days", "Older"] as const;
const groupOf = (c: Chat, age: number) => (c.pinned ? "Pinned" : GROUPS[age <= 0 ? 1 : age === 1 ? 2 : age <= 7 ? 3 : 4]);
/** "2 hours ago"; a chat touched within the minute is "Just now" rather than "12 seconds ago". */
const ago = (t: number) => (Date.now() - t < 60_000 ? "Just now" : formatDistanceToNowStrict(t, { addSuffix: true }));

/** The whole conversation as Markdown, for pasting into notes. */
async function copyChat(c: Chat) {
  const messages = await db.messages.where({ chatId: c.id! }).sortBy("createdAt");
  const text = [`# ${c.title}`, ...messages.map((m) => `${m.role === "user" ? "**You:**" : "**Answer:**"}\n\n${m.content}`)].join("\n\n");
  try {
    await navigator.clipboard.writeText(text);
    toast("Chat copied");
  } catch {
    toast("Couldn't copy the chat. Open it and select the text instead.");
  }
}

/** Past conversations, newest first, grouped by when they were last used. */
export function ChatHistory({ selected, onOpen, onNew, onClose, onCollapse }: {
  selected: number | null;
  onOpen: (id: number) => void;
  onNew: () => void;
  onClose: () => void; // phones: back to the conversation
  onCollapse: () => void; // tablets up: fold the panel away for a wider conversation
}) {
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; title: string } | null>(null);
  const today = useToday();
  // Re-read the "2 hours ago"s each minute, so "Just now" doesn't linger.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const saveName = async () => {
    const title = renaming?.title.replace(/\s+/g, " ").trim();
    if (renaming && title) await db.chats.update(renaming.id, { title: title.slice(0, 120) });
    setRenaming(null);
  };
  const remove = async (c: Chat) => {
    if (!confirm(`Delete "${c.title}"? Its questions and answers will be gone.`)) return;
    await deleteChat(c.id!);
    toast("Chat deleted");
    if (c.id === selected) onNew();
  };
  const data = useLiveQuery(async () => {
    const [chats, subjects] = await Promise.all([db.chats.orderBy("updatedAt").reverse().toArray(), db.subjects.toArray()]);
    return { chats, subjects: new Map(subjects.map((s) => [s.id!, s])) };
  });

  const q = query.trim().toLowerCase();
  const shown = (data?.chats ?? []).filter((c) => {
    const s = data?.subjects.get(c.subjectId);
    return !q || c.title.toLowerCase().includes(q) || s?.name.toLowerCase().includes(q) || s?.code?.toLowerCase().includes(q);
  });
  const grouped = new Map<string, Chat[]>();
  for (const c of shown) {
    const g = groupOf(c, daysBetween(format(new Date(c.updatedAt), "yyyy-MM-dd"), today));
    grouped.set(g, [...(grouped.get(g) ?? []), c]);
  }

  return (
    // From tablets up the history is the page's left column (the page paints it), so it drops its own card.
    <div className="flex min-h-0 w-full flex-col rounded-2xl border border-border bg-surface shadow-sheet md:rounded-none md:border-0 md:bg-transparent md:shadow-none">
      <div className="space-y-2.5 p-3 pb-2">
        <div className="flex items-center gap-1 md:hidden">
          <Button variant="ghost" size="icon" className="-ml-1" onClick={onClose} aria-label="Back to the chat"><ArrowLeft size={16} /></Button>
          <h2 className="flex-1 px-1 text-[13px] font-semibold">History</h2>
        </div>
        <h2 className="sr-only max-md:hidden">History</h2>
        <div className="flex items-center gap-1.5">
          <Button className="min-w-0 flex-1" onClick={onNew}><Plus size={15} /> New study session</Button>
          <Button variant="ghost" size="icon" className="-mr-1 hidden md:inline-flex" onClick={onCollapse} aria-label="Collapse sidebar" title="Collapse sidebar (Ctrl+B)" aria-keyshortcuts="Control+B Meta+B">
            <PanelLeftClose size={17} />
          </Button>
        </div>
        {!!data?.chats.length && (
          <div className="relative">
            <Search size={14} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sessions" aria-label="Search sessions" className="h-9 pl-8 text-[13px]" />
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
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
              <h3 className="px-2.5 pb-1 pt-2.5 text-[12px] font-medium text-faint">{g}</h3>
              <ul className="space-y-px">
                {grouped.get(g)!.map((c) => {
                  const subject = data.subjects.get(c.subjectId);
                  const on = c.id === selected;
                  return (
                    <li key={c.id} style={subjectStyle(subject?.color)} className={cn("group relative rounded-lg transition-colors duration-150", on ? "bg-nav-active" : "hover:bg-surface-2")}>
                      {renaming && renaming.id === c.id ? (
                        <form className="p-1.5" onSubmit={(e) => { e.preventDefault(); saveName(); }}>
                          <Input
                            autoFocus
                            value={renaming.title}
                            onChange={(e) => setRenaming({ id: c.id!, title: e.target.value })}
                            onBlur={saveName}
                            onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
                            aria-label="Chat name"
                            className="h-8 text-[13.5px]"
                          />
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onOpen(c.id!)}
                          aria-current={on ? "true" : undefined}
                          // Right padding leaves room for the ⋯ button.
                          className="press flex w-full min-w-0 flex-col items-start gap-1 rounded-lg py-2 pl-2.5 pr-9 text-left"
                        >
                          <span className="flex w-full min-w-0 items-center gap-2">
                            <span aria-hidden className="subj-dot h-1.5 w-1.5 shrink-0 rounded-full" />
                            <span className={cn("truncate text-[13.5px] leading-snug", on ? "font-semibold text-nav-active-ink" : "font-medium")}>{c.title}</span>
                          </span>
                          <span className="flex w-full min-w-0 items-center gap-2 pl-3.5 text-[12px] text-muted">
                            <Badge className="min-w-0 px-1.5 py-0 text-[11px]">
                              <span className="truncate">{subject?.code || subject?.name || "Subject"}</span>
                            </Badge>
                            <span className="shrink-0 tabular-nums">{ago(c.updatedAt)}</span>
                          </span>
                        </button>
                      )}
                      {renaming?.id !== c.id && (
                        <Menu
                          label={`Options for ${c.title}`}
                          // With a mouse it shows on hover, on keyboard focus, and on the open chat; on touch it's always there.
                          className={cn(
                            "absolute right-1.5 top-1/2 -translate-y-1/2 transition-opacity duration-150",
                            !on && "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100",
                          )}
                          items={[
                            { label: "Rename", icon: <Pencil size={15} />, onSelect: () => setRenaming({ id: c.id!, title: c.title }) },
                            c.pinned
                              ? { label: "Unpin", icon: <PinOff size={15} />, onSelect: () => db.chats.update(c.id!, { pinned: false }) }
                              : { label: "Pin to top", icon: <Pin size={15} />, onSelect: () => db.chats.update(c.id!, { pinned: true }) },
                            { label: "Copy chat", icon: <Copy size={15} />, onSelect: () => copyChat(c) },
                            { label: "Delete", icon: <Trash2 size={15} />, onSelect: () => remove(c), danger: true },
                          ]}
                        />
                      )}
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
