"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowUp, BookOpen, Check, Copy, FileText, History, MessagesSquare, PanelLeftOpen, Paperclip, Pencil, RotateCcw, Square, Target, Trash2, X, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { aiStream } from "@/lib/ai/client";
import type { AiRequest } from "@/lib/ai/schemas";
import { daysBetween } from "@/lib/dates";
import { byWhen } from "@/lib/exams";
import { db, deleteChat } from "@/lib/db";
import { aiModeFields, examInMode, modeShort, pyqMatchesMode, topicsInScope, useExamMode } from "@/lib/mode";
import {
  chatTitle, matchingPyqs, namedSubject, noteExcerpts, prepSummary, rawPaperExcerpts, sourcesOf, starterTiles, type PrepInput,
} from "@/lib/study-chat";
import type { ChatSource, Subject } from "@/lib/types";
import { useToday } from "@/lib/use-today";
import { AiErrorBox } from "../ai-error";
import { Markdown } from "../markdown";
import { Thinking } from "../thinking";
import { isAbort, MAX_TEXT, OfflineHint, topicTitles, useOnline } from "../subject/shared";
import { toast } from "../toast";
import { Badge, Button, Empty, Input, Menu, Segmented, Select, Textarea, buttonClass, cn, daysTone, subjectStyle } from "../ui";
import { Starters } from "./starters";

type Style = NonNullable<AiRequest["answerStyle"]>;
// The prompt still knows "auto" and "revise"; a choice of two is all the header offers. An old saved one of those
// falls back to the first.
const STYLES: { value: Style; label: string; title: string }[] = [
  { value: "simple", label: "Concept / doubt", title: "Plain words, an analogy and an example" },
  { value: "exam", label: "Exam 10-mark", title: "A model answer sized to the marks" },
];
const STYLE_KEY = "amityexams:chatStyle";
const MAX_HISTORY_CHARS = 20_000;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const subjectLabel = (s: Subject) => (s.code ? `${s.name} (${s.code})` : s.name);

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
  // `hide`: the question and answer being regenerated, kept out of sight until the new answer replaces them.
  const [streaming, setStreaming] = useState<{ text: string; sources: ChatSource[]; hide?: number[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [style, setStyleState] = useState<Style>("simple");
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
      // storage unavailable; Concept / doubt it is
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
  // `redo`: the last question and its answer, asked again (Regenerate). They're hidden while the new answer comes
  // and deleted once it's saved; if none arrives they come back as they were.
  // `here`: ask in this chat's subject even if the question names another one.
  const send = async (raw?: string, { retryOf, redo, here }: { retryOf?: number; redo?: number[]; here?: boolean } = {}) => {
    const text = (raw ?? input).trim();
    // A ref, not state: two quick Enters both see the old `streaming` value before React re-renders.
    if (!text || sending.current || !online || !subject || !scope || !material || !messages || !base) return;
    // "how do I start ADA" asked with Networks picked would be answered from the Networks notes. A new chat just
    // moves to the subject it names; a saved one asks first, since the conversation so far is about this subject.
    const named = here || retryOf != null || redo ? undefined : namedSubject(text, base.subjects, subject.id);
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
    const past = messages.filter((m) => m.id !== retryOf && !redo?.includes(m.id!));
    const lastUser = [...past].reverse().find((m) => m.role === "user")?.content ?? "";
    const query = `${text} ${lastUser}`; // a follow-up ("give an example") still finds the earlier topic
    const notes = noteExcerpts(scope.notes, query, 40_000);
    const pyq = matchingPyqs(scope.questions, material.topics, query, { maxChars: 12_000 });
    const rawPapers = pyq.picked.length < 4 ? rawPaperExcerpts(scope.rawPapers, query, 6000) : "";
    const sources = sourcesOf(notes.files, pyq.picked);
    const history = past.slice(-10).map(({ role, content }) => ({ role, content: content.slice(0, MAX_HISTORY_CHARS) }));
    ctrl.current = new AbortController();
    setStreaming({ text: "", sources, hide: redo });
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
          setStreaming({ text: full, sources, hide: redo });
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
            if (redo) await db.messages.bulkDelete(redo);
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
          // A regenerated question is still in the thread, so the box stays as it was.
          if (!redo) setInput((cur) => cur || text);
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
      <div className="w-full md:p-8">
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
      <div className="w-full md:p-8">
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
  // Regenerate asks the last question again; only the newest answer offers it.
  const asked = messages?.at(-2);
  const redo = !busy && online && scope && last?.role === "assistant" && asked?.role === "user" ? [asked.id!, last.id!] : null;
  const shown = streaming?.hide ? messages?.filter((m) => !streaming.hide!.includes(m.id!)) : messages;
  const days = scope?.exam ? daysBetween(today, scope.exam.date) : null;

  // What answers are grounded in, counted, so the student knows when to sync or upload more.
  const notesCount = scope?.notes.length ? plural(scope.notes.length, "note file") : "";
  const papersCount = scope?.questions.length
    ? plural(scope.questions.length, "past-paper question")
    : scope?.rawPapers.length ? plural(scope.rawPapers.length, "past paper") : "";
  const indexed = [notesCount, papersCount].filter(Boolean).join(" & ");
  const season = mode && scope?.ownSeason ? `Past-paper questions from ${modeShort(mode)} papers` : undefined;

  return (
    <div className="flex h-full min-h-0 w-full flex-col" style={subjectStyle(subject?.color)}>
      {/* The workspace's bar: which subject answers come from, how near that exam is, what's indexed, and how
          answers are shaped. */}
      <header className="shrink-0 border-b border-border py-2.5 md:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className={cn("flex min-w-0 max-w-full items-center gap-1.5", renaming !== null && "flex-1")}>
            {/* Phones: opens the history list. Wider screens: only while the panel is folded away, to unfold it. */}
            <Button variant="ghost" size="icon" className={cn("-ml-1.5 shrink-0", !historyHidden && "md:hidden")} onClick={onShowHistory} aria-label="Show history" title="Show history (Ctrl+B)" aria-keyshortcuts="Control+B Meta+B">
              <History size={16} className="md:hidden" />
              <PanelLeftOpen size={17} className="hidden md:block" />
            </Button>
            {base.chat && renaming !== null ? (
              <form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={(e) => { e.preventDefault(); rename(); }}>
                <Input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setRenaming(null)} aria-label="Chat name" className="h-8 min-w-0 flex-1 text-[14px]" />
                <Button type="submit" variant="ghost" size="icon" aria-label="Save name"><Check size={15} /></Button>
                <Button type="button" variant="ghost" size="icon" onClick={() => setRenaming(null)} aria-label="Cancel"><X size={15} /></Button>
              </form>
            ) : base.chat ? (
              // A saved chat keeps its subject.
              <span className="inline-flex h-8 min-w-0 max-w-full items-center gap-2 rounded-full border border-border bg-surface px-3 text-[13px] font-medium" title="This chat's subject">
                <span aria-hidden className="subj-dot h-2 w-2 shrink-0 rounded-full" />
                <span className="min-w-0 truncate">{subject && subjectLabel(subject)}</span>
              </span>
            ) : (
              // A new one picks it here; the dot shows the chosen subject's colour.
              <div className="relative flex min-w-0 max-w-full items-center">
                <span aria-hidden className="subj-dot pointer-events-none absolute left-3 z-10 h-2 w-2 rounded-full" />
                <Select
                  value={subjectId ?? ""}
                  onChange={(e) => setPicked(Number(e.target.value))}
                  aria-label="Subject"
                  disabled={busy}
                  className="h-8 w-auto min-w-0 max-w-full rounded-full border-border pl-7 text-[13px] font-medium shadow-none hover:border-line-strong sm:max-w-[22rem]"
                >
                  {base.subjects.map((s) => <option key={s.id} value={s.id}>{subjectLabel(s)}</option>)}
                </Select>
              </div>
            )}
          </div>
          {renaming === null && (
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
              {days != null && (
                <Badge tone={daysTone(days)}>
                  <Zap aria-hidden />
                  {days === 0 ? "Exam today" : days === 1 ? "Exam tomorrow" : `Exam in ${days} days`}
                </Badge>
              )}
              {scope && (
                <Badge className="min-w-0 max-w-full">
                  <BookOpen aria-hidden />
                  <span className="min-w-0 truncate" title={season}>{indexed ? `${indexed} indexed` : "No notes or past papers yet"}</span>
                </Badge>
              )}
            </div>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Segmented size="sm" label="Answer style" value={style} onChange={setStyle} options={STYLES} />
            {base.chat && !busy && renaming === null && (
              <Menu
                label="Chat actions"
                className="h-8 w-8"
                items={[
                  { label: "Rename", icon: <Pencil size={14} />, onSelect: () => setRenaming(base.chat!.title) },
                  { label: "Delete", icon: <Trash2 size={14} />, onSelect: remove, danger: true },
                ]}
              />
            )}
          </div>
        </div>
      </header>

      {/* The conversation, in a reading column. Phones scroll the page; from tablets up this scrolls on its own
          between the bar and the composer. Below md the page pads the sides itself, so only wider screens pad here. */}
      <div className="flex-1 md:min-h-0 md:overflow-y-auto md:px-8">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 py-6 md:gap-8 md:py-8">
          {!shown ? null : shown.length === 0 && !busy ? (
            subject && scope && (
              <Starters
                subjectName={subject.name}
                grounding={
                  indexed
                    ? `Answers come from your ${[notesCount, papersCount].filter(Boolean).join(" and ")} for this subject${mode ? `, pitched at your ${modeShort(mode).toLowerCase()} exam` : ""}.`
                    : "There are no notes or past papers for this subject yet, so answers use general knowledge. Add some with the paperclip below."
                }
                tiles={starterTiles(scope.prep)}
                disabled={!online}
                onPick={(prompt) => send(prompt)}
              />
            )
          ) : (
            <>
              {shown.map((m) => (
                <Bubble key={m.id} role={m.role} content={m.content} sources={m.sources} onRegenerate={redo && m.id === last?.id ? () => send(asked!.content, { redo }) : undefined} />
              ))}
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
          <div ref={bottom} className="scroll-mb-36 md:scroll-mb-0" />
        </div>
      </div>

      {/* On phones the composer sticks above the bottom bar, so it's reachable without scrolling past the header. */}
      {/* The strip below it, down to the bottom bar, is painted too, so the conversation doesn't show through the gap. */}
      {/* From tablets up: docked at the foot of the workspace, in the same reading column as the conversation. */}
      <div data-composer className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 shrink-0 bg-bg pb-2 pt-1 after:absolute after:inset-x-0 after:top-full after:h-4 after:bg-bg md:static md:bg-transparent md:px-8 md:pb-5 md:after:hidden">
        <div className="mx-auto max-w-3xl space-y-2">
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
            <div role="alert" className="rounded-2xl border border-border bg-surface px-4 py-3 text-[14px] shadow-sheet">
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
          <Dock
            value={input}
            onChange={setInput}
            onSend={() => send()}
            onStop={() => ctrl.current?.abort()}
            busy={busy}
            canSend={!!input.trim() && online && !!scope}
            touch={touch}
            placeholder="Ask a doubt, paste code, or request a past-paper solution…"
            leading={
              subject && (
                <>
                  {/* Files are added on the subject's Materials tab; the chat reads whatever is there. */}
                  <Link href={`/subjects/view?id=${subject.id}&tab=materials`} aria-label="Add notes or papers" title="Add notes or papers" className={buttonClass("ghost", "icon", "rounded-full")}>
                    <Paperclip size={16} />
                  </Link>
                  <span className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 text-xs font-medium text-muted" title={`Answers come from ${subject.name}`}>
                    <span aria-hidden className="subj-dot h-1.5 w-1.5 shrink-0 rounded-full" />
                    <span className="min-w-0 truncate">{subject.code || subject.name}</span>
                  </span>
                </>
              )
            }
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The box a question is typed in, docked at the foot of a conversation (here and on a subject's Ask tab). The text
 * grows to about five lines, then scrolls; under it sit `leading` (the chat's paperclip and subject), a keyboard
 * hint and Send, which fills in once there's something to send.
 */
export function Dock({ value, onChange, onSend, onStop, busy, canSend, touch, placeholder, leading }: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  canSend: boolean;
  touch: boolean; // Enter adds a line (the keyboard has no Shift), so only the button sends
  placeholder: string;
  leading?: ReactNode;
}) {
  const round = "h-9 w-9 rounded-full pointer-coarse:h-10 pointer-coarse:w-10";
  return (
    // One bordered box; the textarea inside is borderless, so focus rings the whole dock instead.
    <form
      className="rounded-2xl border border-line-strong bg-surface shadow-float transition-[border-color,box-shadow] duration-150 focus-within:border-accent focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_16%,transparent),var(--shadow-float)]"
      onSubmit={(e) => { e.preventDefault(); onSend(); }}
    >
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // isComposing: Enter that confirms an IME word (Hindi, Chinese…) must not send.
          if (e.key === "Enter" && !e.shiftKey && !touch && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder={placeholder}
        aria-label="Your question"
        rows={1}
        className="field-sizing-content block max-h-[9rem] min-h-12 resize-none overflow-y-auto border-transparent bg-transparent px-4 pb-1 pt-3 text-[15px] shadow-none hover:border-transparent focus:border-transparent focus:bg-transparent focus:shadow-none focus-visible:outline-none"
      />
      <div className="flex items-center gap-1.5 px-2 pb-2">
        {leading && <div className="flex min-w-0 items-center gap-1.5">{leading}</div>}
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {!touch && <span className="hidden text-xs text-faint md:inline">Shift+Enter for new line</span>}
          {busy ? (
            // A filled square: an outlined one read as an empty checkbox.
            <Button type="button" variant="secondary" size="icon" className={round} onClick={onStop} aria-label="Stop" title="Stop">
              <Square size={11} className="fill-current" />
            </Button>
          ) : (
            // Neutral while there's nothing to send (the primary's disabled look), indigo once there is.
            <Button type="submit" size="icon" className={cn(round, "transition-colors duration-150")} disabled={!canSend} aria-label="Send" title="Send">
              <ArrowUp size={17} />
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

/**
 * One message of a conversation (here and on a subject's Ask tab): a question sits in a bubble, an answer is set
 * on the page under it. `sources` are the notes files and past-paper questions an answer was given (study chat only);
 * `onRegenerate` asks its question again (the newest study-chat answer only).
 */
export function Bubble({ role, content, live, sources, onRegenerate }: {
  role: "user" | "assistant";
  content: string;
  live?: boolean;
  sources?: ChatSource[];
  onRegenerate?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <p className="min-w-0 max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-accent/20 bg-accent-soft px-4 py-2.5 text-[15px] leading-relaxed text-text">{content}</p>
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
  // The ::before widens the tap target on touch screens to about 40px without changing the look.
  const action = "relative inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-text pointer-coarse:before:absolute pointer-coarse:before:-inset-y-1.5 pointer-coarse:before:inset-x-0 pointer-coarse:before:content-[''] [&_svg]:size-3.5";
  // The answer is set straight on the page, full column width, like a handout; only the question sits in a bubble.
  // A bubble around a long answer with tables and code was a box inside a box and narrowed every line.
  return (
    <div className="min-w-0">
      <div aria-busy={live || undefined}>
        <Markdown className="prose-wide">{content}</Markdown>
        {/* Once it's done: the files and papers it was given, as small tags rather than a list, then its actions. */}
        {!live && (
          <>
            {!!sources?.length && (
              <ul aria-label="Sources" className="mt-4 flex min-w-0 flex-wrap gap-1.5">
                {sources.map((s, i) => (
                  <li key={i} className="min-w-0 max-w-full">
                    <Badge className="max-w-[16rem]">
                      {/* An svg's aria-label isn't read reliably, so the kind is spoken as text. */}
                      {s.kind === "notes" ? <FileText aria-hidden /> : <Target aria-hidden />}
                      <span className="sr-only">{s.kind === "notes" ? "Notes: " : "Past paper: "}</span>
                      <span className="min-w-0 truncate font-normal" title={s.label}>{s.label}</span>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            <div className="-ml-2 mt-2 flex items-center gap-0.5">
              <button type="button" onClick={copy} aria-label={copied ? "Copied" : "Copy answer"} title="Copy answer" className={action}>
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copied ? "Copied" : "Copy"}
              </button>
              {onRegenerate && (
                <button type="button" onClick={onRegenerate} aria-label="Regenerate answer" title="Ask the question again" className={action}>
                  <RotateCcw aria-hidden />
                  Regenerate
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
