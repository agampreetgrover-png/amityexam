"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen, Check, Copy, FileText, History, MessagesSquare, Pencil, ScrollText, Send, Square, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { aiStream } from "@/lib/ai/client";
import type { AiRequest } from "@/lib/ai/schemas";
import { daysBetween } from "@/lib/dates";
import { db, deleteChat } from "@/lib/db";
import { aiModeFields, examInMode, modeShort, pyqMatchesMode, topicsInScope, useExamMode } from "@/lib/mode";
import {
  chatTitle, matchingPyqs, noteExcerpts, prepSummary, rawPaperExcerpts, sourcesOf, starterQuestions, type PrepInput,
} from "@/lib/study-chat";
import type { ChatSource } from "@/lib/types";
import { useToday } from "@/lib/use-today";
import { AiErrorBox } from "../ai-error";
import { Markdown } from "../markdown";
import { isAbort, MAX_TEXT, OfflineHint, topicTitles, useOnline } from "../subject/shared";
import { toast } from "../toast";
import { Button, Empty, Input, Segmented, Select, Textarea, cn, subjectStyle } from "../ui";

type Style = NonNullable<AiRequest["answerStyle"]>;
const STYLES: { value: Style; label: string; title: string }[] = [
  { value: "auto", label: "Auto", title: "Fits the answer to the question" },
  { value: "simple", label: "Simple", title: "Plain words, an analogy and an example" },
  { value: "exam", label: "Exam answer", title: "A model answer sized to the marks" },
  { value: "revise", label: "Quick revise", title: "Must-know points only" },
];
const STYLE_KEY = "amityexams:chatStyle";
const MAX_HISTORY_CHARS = 20_000;

/**
 * One study-chat conversation. `chatId` null starts a new one: it's saved, and named after its first question,
 * when that question is sent. Answers draw on the subject's notes and this exam's past papers.
 */
export function ChatThread({ chatId, onCreated, onGone, onShowHistory }: {
  chatId: number | null;
  onCreated: (id: number) => void;
  onGone: () => void; // deleted, or the link pointed at a chat that no longer exists
  onShowHistory: () => void;
}) {
  const online = useOnline();
  const mode = useExamMode();
  const today = useToday();
  const [id, setId] = useState(chatId);
  const [picked, setPicked] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<{ text: string; sources: ChatSource[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [style, setStyleState] = useState<Style>("auto");
  const [renaming, setRenaming] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  // On phones and tablets Enter adds a line (the keyboard has no Shift); the Send button sends.
  const [touch, setTouch] = useState(false);
  useEffect(() => setTouch(window.matchMedia("(pointer: coarse)").matches), []);
  useEffect(() => {
    try {
      const s = localStorage.getItem(STYLE_KEY);
      if (STYLES.some((x) => x.value === s)) setStyleState(s as Style);
    } catch {
      // storage unavailable; Auto it is
    }
  }, []);
  const setStyle = (s: Style) => {
    setStyleState(s);
    try {
      localStorage.setItem(STYLE_KEY, s);
    } catch {
      // not important
    }
  };
  // Leaving the chat stops its answer; whatever arrived is still saved (see send).
  useEffect(() => () => ctrl.current?.abort(), []);

  const base = useLiveQuery(async () => {
    const [subjects, exams, chat] = await Promise.all([
      db.subjects.orderBy("name").toArray(),
      db.exams.where("date").aboveOrEqual(today).sortBy("date"),
      id != null ? db.chats.get(id).then((c) => c ?? null) : undefined,
    ]);
    return { subjects, exams, chat };
  }, [id, today]);

  // A saved chat keeps its subject; a new one starts on the subject with the nearest exam this season.
  const nearest = base?.exams.find((e) => examInMode(e, mode))?.subjectId;
  const subjectId = base?.chat?.subjectId ?? picked ?? nearest ?? base?.subjects[0]?.id ?? null;
  const subject = base?.subjects.find((s) => s.id === subjectId);

  const material = useLiveQuery(async () => {
    if (subjectId == null) return null;
    const [units, topics, materials, questions] = await Promise.all([
      db.units.where({ subjectId }).sortBy("order"),
      db.topics.where({ subjectId }).toArray(),
      db.materials.where({ subjectId }).toArray(),
      db.pyqQuestions.where({ subjectId }).toArray(),
    ]);
    return { units, topics, materials, questions };
  }, [subjectId]);

  const messages = useLiveQuery(() => (id != null ? db.messages.where({ chatId: id }).sortBy("createdAt") : []), [id]) ?? [];

  // This exam's syllabus and past papers. With no paper tagged for this exam yet, every paper is better than none.
  const scope = useMemo(() => {
    if (!material || !subject) return null;
    const topics = topicsInScope(material.topics, material.units, mode);
    const own = mode ? material.questions.filter((q) => q.exam === mode) : material.questions;
    const questions = own.length ? own : material.questions;
    const notes = material.materials.filter((m) => m.kind !== "pyq");
    const rawPapers = material.materials.filter((m) => m.kind === "pyq" && !m.analysedAt && (!mode || pyqMatchesMode(m, mode)));
    const exam = base?.exams.find((e) => e.subjectId === subject.id && examInMode(e, mode));
    const prep: PrepInput = { subjectName: subject.name, mode, exam, today, topics, questions };
    return { topics, questions, notes, rawPapers, prep, exam, ownSeason: own.length > 0 };
  }, [material, subject, mode, base?.exams, today]);

  // Braces matter: newer Chrome returns a Promise from scrollIntoView, and an effect that returns one crashes React.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, streaming?.text]);

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    // A ref, not state: two quick Enters both see the old `streaming` value before React re-renders.
    if (!text || sending.current || !online || !subject || !scope || !material) return;
    sending.current = true;
    setInput("");
    setError(null);
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const query = `${text} ${lastUser}`; // a follow-up ("give an example") still finds the earlier topic
    const notes = noteExcerpts(scope.notes, query, 40_000);
    const pyq = matchingPyqs(scope.questions, material.topics, query, { maxChars: 12_000 });
    const rawPapers = pyq.picked.length < 4 ? rawPaperExcerpts(scope.rawPapers, query, 6000) : "";
    const sources = sourcesOf(notes.files, pyq.picked);
    const history = messages.slice(-10).map(({ role, content }) => ({ role, content: content.slice(0, MAX_HISTORY_CHARS) }));
    ctrl.current = new AbortController();
    setStreaming({ text: "", sources });
    let reply = "";
    let chat = id;
    let created = false;
    let questionId: number | undefined;
    try {
      const now = Date.now();
      let saved: number;
      if (chat == null) {
        saved = (await db.chats.add({ subjectId: subject.id!, title: chatTitle(text), createdAt: now, updatedAt: now })) as number;
        created = true;
        setId(saved);
        onCreated(saved);
      } else {
        saved = chat;
        await db.chats.update(saved, { updatedAt: now });
      }
      chat = saved;
      questionId = await db.messages.add({ subjectId: subject.id!, chatId: saved, role: "user", content: text, createdAt: now });
      reply = await aiStream(
        "study",
        {
          subject: subject.name,
          topics: topicTitles(scope.topics, 60),
          context: notes.text,
          pyqs: [pyq.text, rawPapers].filter(Boolean).join("\n\n"),
          prepNotes: prepSummary(scope.prep),
          answerStyle: style,
          history,
          text: text.slice(0, MAX_TEXT),
          ...aiModeFields(mode, material.units),
        },
        (full) => {
          reply = full;
          setStreaming({ text: full, sources });
        },
        ctrl.current.signal,
      );
    } catch (e) {
      if (!isAbort(e)) setError(e);
    } finally {
      // Keep whatever arrived, even if stopped midway. If nothing did, take the question back out (and the chat,
      // if it was new) and put it back in the box to send again.
      try {
        if (reply.trim() && chat != null) {
          await db.messages.add({ subjectId: subject.id!, chatId: chat, role: "assistant", content: reply, createdAt: Date.now(), sources });
          await db.chats.update(chat, { updatedAt: Date.now() });
        } else {
          if (questionId != null) await db.messages.delete(questionId);
          if (created && chat != null) {
            await deleteChat(chat);
            setId(null);
          }
          setInput((cur) => cur || text);
        }
      } finally {
        setStreaming(null);
        ctrl.current = null;
        sending.current = false;
      }
    }
  };

  const rename = async () => {
    const title = renaming?.trim();
    if (title && id != null) await db.chats.update(id, { title: title.slice(0, 120) });
    setRenaming(null);
  };
  const remove = async () => {
    if (id == null || !confirm("Delete this chat? Its questions and answers will be gone.")) return;
    ctrl.current?.abort();
    await deleteChat(id);
    toast("Chat deleted");
    onGone();
  };

  if (!base) return null;
  if (!base.subjects.length) {
    return (
      <div className="w-full">
        <Empty icon={<BookOpen />} title="Add a subject first">
          <p className="text-sm text-muted">
            The chat answers from each subject&apos;s notes and past papers. <Link href="/subjects" className="text-accent underline underline-offset-2">Add your subjects</Link>, and sync or upload their files.
          </p>
        </Empty>
      </div>
    );
  }
  if (base.chat === null) {
    return (
      <div className="w-full">
        <Empty icon={<MessagesSquare />} title="This chat isn't here any more">
          <p className="text-sm text-muted">It may have been deleted.</p>
          <Button size="sm" className="mt-3" onClick={onGone}>Start a new chat</Button>
        </Empty>
      </div>
    );
  }

  const busy = streaming !== null;
  const days = scope?.exam ? daysBetween(today, scope.exam.date) : null;
  const starters = scope ? starterQuestions(scope.prep) : [];

  return (
    <div className="flex min-h-0 w-full flex-col" style={subjectStyle(subject?.color)}>
      {/* Header: which subject, the chat's name, and how answers are shaped. */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" className="md:hidden" onClick={onShowHistory} aria-label="Chat history"><History size={15} /></Button>
        {base.chat ? (
          renaming !== null ? (
            <form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={(e) => { e.preventDefault(); rename(); }}>
              <Input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setRenaming(null)} aria-label="Chat name" className="h-8 min-w-0 flex-1 text-[14px]" />
              <Button type="submit" variant="ghost" size="sm" aria-label="Save name"><Check size={15} /></Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(null)} aria-label="Cancel"><X size={15} /></Button>
            </form>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span aria-hidden className="subj-dot h-2 w-2 shrink-0 rounded-full" />
              <span className="min-w-0">
                <span className="block truncate text-[14.5px] font-semibold">{base.chat.title}</span>
                <span className="block truncate text-[12px] text-muted">{subject?.name}</span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => setRenaming(base.chat!.title)} aria-label="Rename chat" disabled={busy}><Pencil size={14} /></Button>
              <Button variant="ghost" size="sm" onClick={remove} aria-label="Delete chat" disabled={busy}><Trash2 size={14} /></Button>
            </div>
          )
        ) : (
          <Select value={subjectId ?? ""} onChange={(e) => setPicked(Number(e.target.value))} aria-label="Subject" className="h-9 w-auto min-w-0 max-w-[16rem] flex-1 sm:flex-none" disabled={busy}>
            {base.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        )}
        <Segmented size="sm" label="Answer style" value={style} onChange={setStyle} options={STYLES} className="ml-auto max-w-full overflow-x-auto" />
      </div>

      {/* What answers are grounded in, so the student knows when to sync or upload more. */}
      {scope && (
        <p className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
          <span className="inline-flex items-center gap-1"><FileText size={13} aria-hidden />{scope.notes.length ? `${scope.notes.length} notes file${scope.notes.length === 1 ? "" : "s"}` : "No notes yet"}</span>
          <span className="inline-flex items-center gap-1">
            <ScrollText size={13} aria-hidden />
            {scope.questions.length
              ? `${scope.questions.length} past-paper question${scope.questions.length === 1 ? "" : "s"}${mode && scope.ownSeason ? ` (${modeShort(mode)})` : ""}`
              : scope.rawPapers.length ? `${scope.rawPapers.length} past paper${scope.rawPapers.length === 1 ? "" : "s"} being read` : "No past papers yet"}
          </span>
          {days != null && <span className="subj-ink font-medium">{days === 0 ? "Exam today" : days === 1 ? "Exam tomorrow" : `Exam in ${days} days`}</span>}
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto rounded-xl border border-border bg-surface p-4 shadow-sheet sm:p-5">
        {messages.length === 0 && !busy ? (
          // min-h-full, not h-full: centred while it fits, scrollable (not clipped at the top) on a short phone screen.
          <div className="flex min-h-full flex-col items-start justify-center gap-1.5 px-1">
            <span className="mb-2 grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden><MessagesSquare size={18} /></span>
            <p className="text-[15px] font-semibold">Ask about {subject?.name}</p>
            <p className="max-w-prose text-sm text-muted">
              Answers are taught from your teacher&apos;s notes, checked against past papers (with the year and marks when a question has come
              before), and pitched at your {mode ? modeShort(mode).toLowerCase() : ""} exam.
            </p>
            {starters.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {starters.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={!online}
                    onClick={() => send(s)}
                    className="press rounded-lg border border-border bg-surface px-3 py-1.5 text-left text-[13px] text-text shadow-control hover:border-line-strong disabled:opacity-45"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {messages.map((m) => <Bubble key={m.id} role={m.role} content={m.content} sources={m.sources} />)}
            {streaming && <Bubble role="assistant" content={streaming.text || "…"} sources={streaming.sources} live />}
          </>
        )}
        <div ref={bottom} />
      </div>

      {/* On phones the composer sticks above the bottom bar, so it's reachable without scrolling past the header. */}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 mt-3 space-y-2 border-t border-border bg-bg pb-1 pt-2 md:static md:border-t-0 md:bg-transparent md:pb-0 md:pt-0">
        <OfflineHint online={online} />
        <AiErrorBox error={error} />
        <form
          className="flex items-end gap-2 rounded-xl border border-border bg-surface p-1.5 shadow-sheet transition-[border-color,box-shadow] duration-150 focus-within:border-accent focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_16%,transparent)]"
          onSubmit={(e) => { e.preventDefault(); send(); }}
        >
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // isComposing: Enter that confirms an IME word (Hindi, Chinese…) must not send.
              if (e.key === "Enter" && !e.shiftKey && !touch && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={touch ? "Ask a doubt or a past-paper question" : "Ask a doubt or a past-paper question. Enter sends, Shift+Enter adds a line."}
            aria-label="Your question"
            className="min-h-11 flex-1 resize-none border-transparent bg-transparent px-2.5 text-[15px] shadow-none hover:border-transparent focus:border-transparent focus:bg-transparent focus:shadow-none focus-visible:outline-none"
            rows={2}
          />
          {busy ? (
            <Button type="button" variant="secondary" className="h-11 w-11 shrink-0 px-0" onClick={() => ctrl.current?.abort()} aria-label="Stop"><Square size={16} /></Button>
          ) : (
            <Button type="submit" className="h-11 min-w-11 shrink-0 px-0 sm:px-4" disabled={!input.trim() || !online || !scope} aria-label="Send">
              <Send size={16} /><span className="hidden sm:inline">Send</span>
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}

function Bubble({ role, content, sources, live }: { role: "user" | "assistant"; content: string; sources?: ChatSource[]; live?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <p className="min-w-0 max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent-soft px-4 py-2.5 text-[15px] leading-relaxed">{content}</p>
      </div>
    );
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Couldn't copy. Select the text instead.");
    }
  };
  return (
    <div className="group flex justify-start">
      <div className="min-w-0 max-w-[92%] rounded-2xl rounded-bl-md bg-surface-2 px-4 py-2.5">
        <Markdown>{content}</Markdown>
        {(!!sources?.length || !live) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
            {sources?.map((s) => (
              <span key={`${s.kind}:${s.label}`} className="inline-flex max-w-full items-center gap-1 rounded-md bg-surface px-1.5 py-0.5 text-[11.5px] text-muted ring-1 ring-inset ring-border">
                {s.kind === "pyq" ? <ScrollText size={12} aria-hidden className="shrink-0" /> : <FileText size={12} aria-hidden className="shrink-0" />}
                <span className="truncate">{s.kind === "pyq" ? `PYQ ${s.label}` : s.label}</span>
              </span>
            ))}
            {!live && (
              <button type="button" onClick={copy} aria-label="Copy answer" className={cn("ml-auto rounded-md p-1 text-muted hover:bg-surface hover:text-text")}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
