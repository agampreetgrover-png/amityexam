"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { MessageCircle, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { retrieve } from "@/lib/retrieve";
import { aiStream } from "@/lib/ai/client";
import { aiModeFields, materialsForMode } from "@/lib/mode";
import { AiErrorBox } from "../ai-error";
import { Bubble, Dock } from "../study-chat/thread";
import { Thinking } from "../thinking";
import { Button } from "../ui";
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
  // Leaving the tab (or switching exam mode, which remounts it) stops its answer; whatever arrived is still saved.
  useEffect(() => () => ctrl.current?.abort(), []);

  // This tab's own thread; the study chat's conversations (chatId set) live on the Chat page.
  // Both undefined while loading, so the starter screen and "No materials uploaded" don't flash.
  const messages = useLiveQuery(() => db.messages.where({ subjectId }).filter((m) => m.chatId == null).sortBy("createdAt"), [subjectId]);
  // Study material plus only this exam's past papers (never the other exam's or unknown ones).
  const allMaterials = useMaterials(subjectId);
  const materials = allMaterials && materialsForMode(allMaterials, mode);

  // Braces matter: newer Chrome returns a Promise from scrollIntoView, and an effect that returns one crashes React.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages?.length, streaming]);

  const send = async () => {
    const text = input.trim();
    // A ref, not state: two quick Enters both see the old `streaming` value before React re-renders.
    if (!text || sending.current || !online || !messages || !materials) return; // offline: keep the question in the box instead of failing
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
    if (confirm("Clear this subject's chat history?")) await db.messages.where({ subjectId }).filter((m) => m.chatId == null).delete();
  };

  // Phones scroll the page, like the Chat page: a fixed-height box there left the answer a thin strip between the
  // header and the composer. From tablets up it's a box that fills the window and scrolls inside.
  return (
    <div className="flex flex-col md:h-[calc(100dvh-21.5rem)] md:min-h-96">
      <div className="mb-2 flex min-h-8 items-center justify-between gap-2 text-[13px] text-muted">
        <span className="min-w-0">{materials && (materials.length ? `Answers use your ${materials.length} uploaded file${materials.length === 1 ? "" : "s"}` : "No materials uploaded, so answers are general")}</span>
        {!!messages?.length && <Button variant="ghost" size="sm" onClick={clear} disabled={streaming !== null} className="shrink-0"><Trash2 size={14} /> Clear chat</Button>}
      </div>

      <div className="flex min-h-[50dvh] flex-col gap-4 rounded-2xl border border-border bg-surface p-4 shadow-sheet sm:p-5 md:min-h-0 md:flex-1 md:overflow-y-auto">
        {!messages ? null : messages.length === 0 && streaming === null ? (
          <div className="flex flex-1 flex-col items-start justify-center gap-1.5 px-1">
            <span className="mb-2 grid h-9 w-9 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden><MessageCircle size={18} /></span>
            <p className="text-[15px] font-semibold">Ask about anything in {subject.name}</p>
            <p className="max-w-prose text-sm text-muted">
              For example, &ldquo;Explain normalization with an example&rdquo; or &ldquo;Difference between TCP and UDP for 5 marks&rdquo;.
            </p>
          </div>
        ) : (
          <>
            {messages.map((m) => <Bubble key={m.id} role={m.role} content={m.content} />)}
            {streaming !== null && (streaming ? <Bubble role="assistant" content={streaming} live /> : <Thinking />)}
          </>
        )}
        {/* On phones the page scrolls, so keep the newest line clear of the composer pinned over it. */}
        <div ref={bottom} className="scroll-mb-36 md:scroll-mb-0" />
      </div>

      {/* On phones the composer sticks above the bottom bar, so it's reachable without scrolling past the header. */}
      {/* The strip behind it is painted the page's own colour with a top rule, so scrolled content passes under it instead of showing through. */}
      {/* The strip below it, down to the bottom bar, is painted too, so the conversation doesn't show through the gap. */}
      <div data-composer className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 mt-3 space-y-2 border-t border-border bg-bg pb-1 pt-2 after:absolute after:inset-x-0 after:top-full after:h-4 after:bg-bg md:static md:border-t-0 md:bg-transparent md:pb-0 md:pt-0 md:after:hidden">
        <OfflineHint online={online} />
        <AiErrorBox error={error} />
        {/* The same dock as the Chat page. */}
        <Dock
          value={input}
          onChange={setInput}
          onSend={send}
          onStop={() => ctrl.current?.abort()}
          busy={streaming !== null}
          canSend={!!input.trim() && online}
          touch={touch}
          placeholder="Ask a question"
        />
      </div>
    </div>
  );
}
