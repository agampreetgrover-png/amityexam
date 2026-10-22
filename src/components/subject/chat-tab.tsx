"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, Square, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { retrieve } from "@/lib/retrieve";
import { aiStream } from "@/lib/ai/client";
import { aiModeFields, materialsForMode } from "@/lib/mode";
import { AiErrorBox } from "../ai-error";
import { Markdown } from "../markdown";
import { Button, Textarea, cn } from "../ui";
import { isAbort, MAX_TEXT, OfflineHint, topicTitles, useMaterials, useOnline, type TabProps } from "./shared";

const MAX_HISTORY_CHARS = 20_000;

export function ChatTab({ subject, units, topics, mode }: TabProps) {
  const subjectId = subject.id!;
  const online = useOnline();
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const ctrl = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  // On phones and tablets Enter adds a line (the keyboard has no Shift); the Send button sends.
  const [touch, setTouch] = useState(false);
  useEffect(() => setTouch(window.matchMedia("(pointer: coarse)").matches), []);

  const messages = useLiveQuery(() => db.messages.where({ subjectId }).sortBy("createdAt"), [subjectId]) ?? [];
  // Study material plus only this exam's past papers (never the other exam's or unknown ones).
  const materials = materialsForMode(useMaterials(subjectId), mode);

  // Braces matter: newer Chrome returns a Promise from scrollIntoView, and an effect that returns one crashes React.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, streaming]);

  const send = async () => {
    const text = input.trim();
    // A ref, not state: two quick Enters both see the old `streaming` value before React re-renders.
    if (!text || sending.current || !online) return; // offline: keep the question in the box instead of failing
    sending.current = true;
    setInput("");
    setError(null);
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    // Long old replies are trimmed to stay within the API's per-message limit.
    const history = messages.slice(-10).map(({ role, content }) => ({ role, content: content.slice(0, MAX_HISTORY_CHARS) }));
    const context = retrieve(materials.map((m) => m.text), `${text} ${lastUser}`, 10_000);
    ctrl.current = new AbortController();
    setStreaming("");
    let reply = "";
    let questionId: number | undefined;
    try {
      questionId = await db.messages.add({ subjectId, role: "user", content: text, createdAt: Date.now() });
      reply = await aiStream(
        "chat",
        {
          subject: subject.name, topics: topicTitles(topics, 60), context, history,
          text: text.slice(0, MAX_TEXT), ...aiModeFields(mode, units),
        },
        (full) => { reply = full; setStreaming(full); },
        ctrl.current.signal,
      );
    } catch (e) {
      if (!isAbort(e)) setError(e);
    } finally {
      // Keep whatever arrived, even if stopped midway. If nothing arrived (stopped early, or it failed),
      // don't leave an unanswered question in the chat: put it back in the box to send again.
      try {
        if (reply.trim()) await db.messages.add({ subjectId, role: "assistant", content: reply, createdAt: Date.now() });
        else {
          if (questionId != null) await db.messages.delete(questionId);
          setInput((cur) => cur || text);
        }
      } finally {
        setStreaming(null);
        ctrl.current = null;
        sending.current = false;
      }
    }
  };

  const clear = async () => {
    if (confirm("Clear this subject's chat history?")) await db.messages.where({ subjectId }).delete();
  };

  return (
    <div className="flex h-[calc(100dvh-17rem)] min-h-96 flex-col md:h-[calc(100dvh-18rem)]">
      <div className="mb-2 flex min-h-8 items-center justify-between gap-2 text-[13px] text-muted">
        <span className="min-w-0">{materials.length ? `Answers use your ${materials.length} uploaded file${materials.length === 1 ? "" : "s"}` : "No materials uploaded, so answers are general"}</span>
        {messages.length > 0 && <Button variant="ghost" size="sm" onClick={clear} className="shrink-0"><Trash2 size={14} /> Clear chat</Button>}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto rounded-lg border border-border bg-surface p-4 sm:p-5">
        {messages.length === 0 && streaming === null ? (
          <div className="flex h-full flex-col items-start justify-center gap-1.5 px-1">
            <MessageCircle size={18} className="mb-1 text-muted" aria-hidden />
            <p className="text-[15px] font-semibold">Ask about anything in {subject.name}</p>
            <p className="max-w-prose text-sm text-muted">
              For example, &ldquo;Explain normalization with an example&rdquo; or &ldquo;Difference between TCP and UDP for 5 marks&rdquo;.
            </p>
          </div>
        ) : (
          <>
            {messages.map((m) => <Bubble key={m.id} role={m.role} content={m.content} />)}
            {streaming !== null && <Bubble role="assistant" content={streaming || "…"} />}
          </>
        )}
        <div ref={bottom} />
      </div>

      {/* On phones the composer sticks above the bottom bar, so it's reachable without scrolling past the header. */}
      {/* The strip behind it is solid white with a top rule, so scrolled content passes under it instead of showing through. */}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 mt-3 space-y-2 border-t border-border bg-surface pb-1 pt-2 md:static md:border-t-0 md:bg-transparent md:pb-0 md:pt-0">
        <OfflineHint online={online} />
        <AiErrorBox error={error} />
        {/* The composer is one bordered box; the textarea inside is borderless, so focus rings the whole box instead. */}
        <form
          className="flex items-end gap-2 rounded-lg border border-border bg-surface p-1.5 transition-[border-color,box-shadow] duration-150 focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgb(27_58_122/0.12)]"
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
            placeholder={touch ? "Ask a question" : "Ask a question. Enter sends, Shift+Enter adds a line."}
            aria-label="Your question"
            className="min-h-11 flex-1 resize-none border-transparent bg-transparent px-2.5 text-[15px] hover:border-transparent focus:border-transparent focus:bg-transparent focus:shadow-none focus-visible:outline-none"
            rows={2}
          />
          {streaming !== null ? (
            <Button type="button" variant="secondary" className="h-11 w-11 shrink-0 px-0" onClick={() => ctrl.current?.abort()} aria-label="Stop"><Square size={16} /></Button>
          ) : (
            <Button type="submit" className="h-11 min-w-11 shrink-0 px-0 sm:px-4" disabled={!input.trim() || !online} aria-label="Send">
              <Send size={16} /><span className="hidden sm:inline">Send</span>
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}

function Bubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  return (
    <div className={cn("flex", role === "user" ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "min-w-0 max-w-[88%]",
          role === "user"
            ? "rounded-lg bg-accent-soft px-4 py-2.5 text-text"
            : "rounded-lg bg-surface-2 px-4 py-1.5",
        )}
      >
        {role === "user" ? <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{content}</p> : <Markdown>{content}</Markdown>}
      </div>
    </div>
  );
}
