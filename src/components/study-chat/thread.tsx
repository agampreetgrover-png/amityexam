"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen, Check, Copy, FileText, History, MessagesSquare, PanelLeftOpen, Pencil, ScrollText, Send, Square, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { aiStream } from "@/lib/ai/client";
import type { AiRequest } from "@/lib/ai/schemas";
import { daysBetween } from "@/lib/dates";
import { byWhen } from "@/lib/exams";
import { db, deleteChat } from "@/lib/db";
import { aiModeFields, examInMode, modeShort, pyqMatchesMode, topicsInScope, useExamMode } from "@/lib/mode";
import {
  chatTitle, matchingPyqs, namedSubject, noteExcerpts, prepSummary, rawPaperExcerpts, sourcesOf, starterQuestions, type PrepInput,
} from "@/lib/study-chat";
import type { ChatSource, Subject } from "@/lib/types";
import { useToday } from "@/lib/use-today";
import { AiErrorBox } from "../ai-error";
import { Markdown } from "../markdown";
import { Thinking } from "../thinking";
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
export function ChatThread({ chatId, onCreated, onDiscarded, onGone, onShowHistory, historyHidden }: {
  chatId: number | null;
  onCreated: (id: number) => void;
  onDiscarded: () => void; // the new chat's first answer failed or was stopped, so it was taken back out
  onGone: () => void; // deleted, or the link pointed at a chat that no longer exists
  onShowHistory: () => void;
  historyHidden: boolean; // folded away on a wide screen, so the History button shows there too
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
  // A question that names another subject: asked there once that subject's notes have loaded (`pending`), or,
  // in a saved chat, held until the student says where to ask it (`offSubject`).
  const [pending, setPending] = useState<{ text: string; subjectId: number } | null>(null);
  const [offSubject, setOffSubject] = useState<{ text: string; subject: Subject } | null>(null);
  // The question this thread last sent. Its answer is saved just before `busy` clears, but the live query can
  // catch up a moment later, so it isn't mistaken for one left unanswered.
  const [sent, setSent] = useState<number>();
  const ctrl = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const mounted = useRef(true);
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
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ctrl.current?.abort();
    };
  }, []);

  const base = useLiveQuery(async () => {
    const [subjects, exams, chat] = await Promise.all([
      db.subjects.orderBy("name").toArray(),
      db.exams.where("date").aboveOrEqual(today).toArray().then((es) => es.sort(byWhen)),
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
    return { subjectId, units, topics, materials, questions };
  }, [subjectId]);

  // Undefined while loading, so opening a saved chat doesn't flash the starter screen.
  const messages = useLiveQuery(() => (id != null ? db.messages.where({ chatId: id }).sortBy("createdAt") : []), [id]);

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
  }, [messages?.length, streaming?.text]);

  // `retryOf`: a question left without an answer (the page was closed mid-answer). It's asked again as new and
  // the old copy is deleted, so neither the history sent nor the thread has it twice.
  // `here`: ask in this chat's subject even if the question names another one.
  const send = async (raw?: string, { retryOf, here }: { retryOf?: number; here?: boolean } = {}) => {
    const text = (raw ?? input).trim();
    // A ref, not state: two quick Enters both see the old `streaming` value before React re-renders.
    if (!text || sending.current || !online || !subject || !scope || !material || !messages || !base) return;
    // "how do I start ADA" asked with Networks picked would be answered from the Networks notes. A new chat just
    // moves to the subject it names; a saved one asks first, since the conversation so far is about this subject.
    const named = here || retryOf != null ? undefined : namedSubject(text, base.subjects, subject.id);
    if (named) {
      if (raw == null) setInput("");
      if (id == null && !messages.length) {
        setPicked(named.id!);
        setPending({ text, subjectId: named.id! });
        toast(`Asking in ${named.name}`);
      } else {
        setOffSubject({ text, subject: named });
      }
      return;
    }
    setOffSubject(null);
    sending.current = true;
    if (raw == null) setInput(""); // a button's question (Ask again, a starter) leaves a half-typed draft alone
    setError(null);
    const past = messages.filter((m) => m.id !== retryOf);
    const lastUser = [...past].reverse().find((m) => m.role === "user")?.content ?? "";
    const query = `${text} ${lastUser}`; // a follow-up ("give an example") still finds the earlier topic
    const notes = noteExcerpts(scope.notes, query, 40_000);
    const pyq = matchingPyqs(scope.questions, material.topics, query, { maxChars: 12_000 });
    const rawPapers = pyq.picked.length < 4 ? rawPaperExcerpts(scope.rawPapers, query, 6000) : "";
    const sources = sourcesOf(notes.files, pyq.picked);
    const history = past.slice(-10).map(({ role, content }) => ({ role, content: content.slice(0, MAX_HISTORY_CHARS) }));
    ctrl.current = new AbortController();
    setStreaming({ text: "", sources });
    let reply = "";
    let chat = id;
    let created = false;
    let questionId: number | undefined;
    try {
      // Deleted once `busy` is set, so the "No answer arrived" row doesn't flash back before the answer starts.
      if (retryOf != null) await db.messages.delete(retryOf);
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
      setSent(questionId);
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
          const saved = chat;
          await db.transaction("rw", db.chats, db.messages, async () => {
            // Deleted from History mid-answer: don't leave its answer behind with no chat.
            if (!(await db.chats.get(saved))) return;
            await db.messages.add({ subjectId: subject.id!, chatId: saved, role: "assistant", content: reply, createdAt: Date.now(), sources });
            await db.chats.update(saved, { updatedAt: Date.now() });
          });
        } else {
          if (questionId != null) await db.messages.delete(questionId);
          if (created && chat != null) {
            await deleteChat(chat);
            setId(null);
            // Only if still showing: after a switch to another chat this would unselect that one.
            if (mounted.current) onDiscarded();
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

  // A question moved to another subject goes once that subject's notes and papers have loaded.
  useEffect(() => {
    if (!pending || material?.subjectId !== pending.subjectId || !scope || !messages || sending.current) return;
    setPending(null);
    void send(pending.text, { here: true });
    // `send` is new every render; these are what decide whether it can go yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, material, scope, messages]);

  // Leaves this saved chat for a new one on the subject the question named, and asks it there.
  const askIn = (target: Subject, text: string) => {
    ctrl.current?.abort();
    setOffSubject(null);
    setId(null);
    onDiscarded(); // the page forgets the saved chat's id without remounting this thread
    setPicked(target.id!);
    setPending({ text, subjectId: target.id! });
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
            The chat answers from each subject&apos;s notes and past papers. <Link href="/subjects" className="font-medium text-accent underline underline-offset-2">Add your subjects</Link>, and sync or upload their files.
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
  // A question with no answer after it: the page was closed or reloaded mid-answer, so send's cleanup never ran.
  const last = messages?.at(-1);
  const stranded = !busy && last?.role === "user" && last.id !== sent ? last : null;
  const days = scope?.exam ? daysBetween(today, scope.exam.date) : null;
  const starters = scope ? starterQuestions(scope.prep) : [];

  return (
    <div className="flex min-h-0 w-full flex-col" style={subjectStyle(subject?.color)}>
      {/* Header: which subject, the chat's name, and how answers are shaped. On desktop it's the bar across the top of
          the sheet, level with the history's (h-16). */}
      <div className="md:flex md:min-h-16 md:flex-col md:justify-center md:border-b md:border-border md:px-6 md:py-1.5">
        <div className="mb-2 flex flex-wrap items-center gap-2 md:mb-0">
          {/* Phones: opens the history list. Wider screens: only while the panel is folded away, to unfold it. */}
          <Button variant="secondary" size="sm" className={cn(!historyHidden && "md:hidden")} onClick={onShowHistory} aria-label="Show history" title="Show history">
            <History size={15} className="md:hidden" />
            <PanelLeftOpen size={16} className="hidden md:block" />
          </Button>
          {base.chat ? (
            renaming !== null ? (
              <form className="flex min-w-0 grow basis-56 items-center gap-1 sm:basis-0" onSubmit={(e) => { e.preventDefault(); rename(); }}>
                <Input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setRenaming(null)} aria-label="Chat name" className="h-8 min-w-0 flex-1 text-[14px]" />
                <Button type="submit" variant="ghost" size="sm" aria-label="Save name"><Check size={15} /></Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(null)} aria-label="Cancel"><X size={15} /></Button>
              </form>
            ) : (
              // A real basis on phones, so the style menu drops to a line of its own instead of crushing the chat's name.
              <div className="flex min-w-0 grow basis-56 items-center gap-2 sm:basis-0">
                <span aria-hidden className="subj-dot h-2 w-2 shrink-0 rounded-full" />
                <span className="min-w-0 truncate text-[14.5px] font-semibold">{base.chat.title}</span>
                <Button variant="ghost" size="sm" onClick={() => setRenaming(base.chat!.title)} aria-label="Rename chat" disabled={busy}><Pencil size={14} /></Button>
                <Button variant="ghost" size="sm" onClick={remove} aria-label="Delete chat" disabled={busy}><Trash2 size={14} /></Button>
              </div>
            )
          ) : (
            <Select value={subjectId ?? ""} onChange={(e) => setPicked(Number(e.target.value))} aria-label="Subject" className="h-9 w-auto min-w-0 max-w-[16rem] flex-1 sm:flex-none" disabled={busy}>
              {base.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )}
          {/* Four buttons need a row of their own on a phone, and crowd out the chat's name beside the history on a laptop,
              so a menu stands in for them there. */}
          <Select value={style} onChange={(e) => setStyle(e.target.value as Style)} aria-label="Answer style" className="ml-auto h-9 w-auto shrink-0 sm:hidden md:inline-block md:h-8 xl:hidden">
            {STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
          <Segmented size="sm" label="Answer style" value={style} onChange={setStyle} options={STYLES} className="hidden sm:ml-auto sm:inline-flex md:hidden xl:inline-flex" />
        </div>

        {/* What answers are grounded in, so the student knows when to sync or upload more. A saved chat names its
            subject first; a new one shows it in the picker above. */}
        {scope && (
          // One line on desktop, so the bar stays level with the history's. The countdown comes straight after the
          // subject and never shrinks; the subject name and the counts give way instead.
          <p className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted md:mb-0 md:flex-nowrap md:whitespace-nowrap">
            {base.chat && <span className="min-w-0 max-w-full truncate text-text/80">{subject?.name}</span>}
            {days != null && <span className="subj-ink shrink-0 font-medium">{days === 0 ? "Exam today" : days === 1 ? "Exam tomorrow" : `Exam in ${days} days`}</span>}
            <span className="inline-flex min-w-0 items-center gap-1"><FileText size={13} aria-hidden className="shrink-0" /><span className="truncate">{scope.notes.length ? `${scope.notes.length} notes file${scope.notes.length === 1 ? "" : "s"}` : "No notes yet"}</span></span>
            <span className="inline-flex min-w-0 items-center gap-1">
              <ScrollText size={13} aria-hidden className="shrink-0" />
              <span className="truncate">
                {scope.questions.length
                  ? `${scope.questions.length} past-paper question${scope.questions.length === 1 ? "" : "s"}${mode && scope.ownSeason ? ` (${modeShort(mode)})` : ""}`
                  : scope.rawPapers.length ? `${scope.rawPapers.length} past paper${scope.rawPapers.length === 1 ? "" : "s"} being read` : "No past papers yet"}
              </span>
            </span>
          </p>
        )}
      </div>

      {/* Phones: a sheet of its own. Desktop: the open page of the one sheet, with the conversation set in a reading
          column (about 70 characters a line) rather than stretched across the window. */}
      <div className="min-h-[50dvh] flex-1 rounded-xl border border-border bg-surface p-4 shadow-sheet sm:p-5 md:min-h-0 md:overflow-y-auto md:rounded-none md:border-0 md:bg-transparent md:px-8 md:py-8 md:shadow-none">
        <div className="mx-auto flex min-h-full max-w-[46rem] flex-col gap-5 md:gap-8">
          {!messages ? null : messages.length === 0 && !busy ? (
            // flex-1 in a min-h-full column: centred while it fits, scrollable (not clipped at the top) on a short screen.
            <div className="flex flex-1 flex-col items-start justify-center gap-1.5 px-1">
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
              {messages.map((m) => <Bubble key={m.id} role={m.role} content={m.content} />)}
              {stranded && (
                <div className="flex items-center justify-end gap-2 text-[13px] text-muted">
                  No answer arrived.
                  <Button variant="secondary" size="sm" disabled={!online || !scope} onClick={() => send(stranded.content, { retryOf: stranded.id })}>Ask again</Button>
                </div>
              )}
              {streaming && (streaming.text ? <Bubble role="assistant" content={streaming.text} live /> : <Thinking />)}
            </>
          )}
          {/* On phones the page scrolls, so keep the newest line clear of the composer pinned over it (the page's own
              scroll-padding already clears the bottom bar). */}
          <div ref={bottom} className="scroll-mb-28 md:scroll-mb-0" />
        </div>
      </div>

      {/* On phones the composer sticks above the bottom bar, so it's reachable without scrolling past the header. */}
      {/* The strip below it, down to the bottom bar, is painted too, so the conversation doesn't show through the gap. */}
      {/* Desktop: the foot of the sheet, ruled off, in the same reading column as the conversation. */}
      <div data-composer className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 mt-3 border-t border-border bg-bg pb-1 pt-2 after:absolute after:inset-x-0 after:top-full after:h-4 after:bg-bg md:static md:mt-0 md:bg-transparent md:px-8 md:pb-5 md:pt-4 md:after:hidden">
        <div className="mx-auto max-w-[46rem] space-y-2">
          {/* For screen readers: once when words start arriving, once when the answer is done. Here, not in the
              conversation, because this stays mounted; while it waits, Thinking's own status speaks. Only an answer
              saved after the question this thread sent counts, so opening a saved chat, or a stop before any words,
              says nothing. */}
          <p role="status" className="sr-only">
            {busy ? (streaming.text ? "Writing the answer" : "") : sent != null && last?.role === "assistant" && (last.id ?? 0) > sent ? "Answer finished" : ""}
          </p>
          <OfflineHint online={online} />
          <AiErrorBox error={error} />
          {offSubject && (
            <div role="alert" className="rounded-xl border border-border bg-surface px-4 py-3 text-[14px] shadow-sheet">
              <p>
                That sounds like <span className="font-semibold">{offSubject.subject.name}</span>. This chat answers from your{" "}
                {subject?.name} notes.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => askIn(offSubject.subject, offSubject.text)}>Ask in {offSubject.subject.name}</Button>
                <Button size="sm" variant="secondary" onClick={() => send(offSubject.text, { here: true })}>Ask here anyway</Button>
                <Button size="sm" variant="ghost" onClick={() => { setInput(offSubject.text); setOffSubject(null); }}>Edit question</Button>
              </div>
            </div>
          )}
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
              placeholder={touch ? "Ask a doubt or a past-paper question" : "Ask a doubt or a past-paper question. Shift+Enter for a new line."}
              aria-label="Your question"
              className="field-sizing-content max-h-40 min-h-11 flex-1 resize-none border-transparent bg-transparent px-2.5 text-[15px] shadow-none hover:border-transparent focus:border-transparent focus:bg-transparent focus:shadow-none focus-visible:outline-none"
              rows={2}
            />
            {busy ? (
              // A filled square with its word, shaped like Send: an outlined one read as an empty checkbox.
              <Button type="button" variant="secondary" className="h-11 min-w-11 shrink-0 px-0 sm:px-4" onClick={() => ctrl.current?.abort()} aria-label="Stop">
                <Square size={11} className="fill-current" /><span className="hidden sm:inline">Stop</span>
              </Button>
            ) : (
              <Button type="submit" className="h-11 min-w-11 shrink-0 px-0 sm:px-4" disabled={!input.trim() || !online || !scope} aria-label="Send">
                <Send size={16} /><span className="hidden sm:inline">Send</span>
              </Button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

/**
 * Until the first words arrive: what's happening and, once it's a while, for how long. Free models can sit
 * for half a minute before they start, and a bare "…" looked like the chat had stopped.
 */
function Bubble({ role, content, live }: { role: "user" | "assistant"; content: string; live?: boolean }) {
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
  // The answer is set straight on the page, full column width, like a handout; only the question sits in a bubble.
  // A bubble around a long answer with tables and code was a box inside a box and narrowed every line.
  return (
    <div className="group min-w-0 px-1">
      <div aria-busy={live || undefined}>
        <Markdown>{content}</Markdown>
        {/* Just the copy button: the list of files and papers behind each answer was clutter. The answer cites them itself. */}
        {!live && (
          <div className="-ml-1 mt-2 flex">
            {/* The ::before widens the tap target on touch screens to about 40px without changing the icon's look. */}
            <button type="button" onClick={copy} aria-label="Copy answer" className="relative rounded-md p-1 text-faint hover:bg-surface-2 hover:text-text pointer-coarse:before:absolute pointer-coarse:before:-inset-2.5 pointer-coarse:before:content-['']">
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
