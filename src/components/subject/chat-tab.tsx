"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, Square, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { retrieve } from "@/lib/retrieve";
import { aiStream } from "@/lib/ai/client";
import { aiModeFields } from "@/lib/mode";
import { AiErrorBox } from "../ai-error";
import { Markdown } from "../markdown";
import { Button, Textarea, cn } from "../ui";
import { isAbort, MAX_TEXT, OfflineHint, useMaterials, useOnline, type TabProps } from "./shared";

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

  const messages = useLiveQuery(() => db.messages.where({ subjectId }).sortBy("createdAt"), [subjectId]) ?? [];
  const materials = useMaterials(subjectId);

  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [messages.length, streaming]);

  const send = async () => {
    const text = input.trim();
    // A ref, not state: two quick Enters both see the old `streaming` value before React re-renders.
    if (!text || sending.current) return;
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
    try {
      await db.messages.add({ subjectId, role: "user", content: text, createdAt: Date.now() });
      reply = await aiStream(
        "chat",
        {
          subject: subject.name, topics: topics.map((t) => t.title).slice(0, 60), context, history,
          text: text.slice(0, MAX_TEXT), ...aiModeFields(mode, units),
        },
        (full) => { reply = full; setStreaming(full); },
        ctrl.current.signal,
      );
    } catch (e) {
      if (!isAbort(e)) setError(e);
    } finally {
      // Keep whatever arrived, even if stopped midway.
      try {
        if (reply.trim()) await db.messages.add({ subjectId, role: "assistant", content: reply, createdAt: Date.now() });
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
      <div className="mb-2 flex min-h-8 items-center justify-between gap-2 text-xs text-muted">
        <span>{materials.length ? `Answers use your ${materials.length} uploaded file${materials.length === 1 ? "" : "s"}` : "No materials uploaded, so answers are general"}</span>
        {messages.length > 0 && <Button variant="ghost" size="sm" onClick={clear}><Trash2 size={13} /> Clear chat</Button>}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto rounded-2xl border border-border bg-surface p-4 shadow-[0_1px_3px_rgb(17_24_39/0.04)] sm:p-5">
        {messages.length === 0 && streaming === null ? (
          <div className="flex h-full flex-col items-start justify-center gap-2 px-1">
            <span className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent"><MessageCircle size={20} /></span>
            <p className="font-semibold">Ask about anything in {subject.name}</p>
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

      <div className="mt-3 space-y-2">
        <OfflineHint online={online} />
        <AiErrorBox error={error} />
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask a question. Enter sends, Shift+Enter adds a line."
            aria-label="Your question"
            className="min-h-11 flex-1 resize-none"
            rows={2}
          />
          {streaming !== null ? (
            <Button type="button" variant="secondary" className="h-11" onClick={() => ctrl.current?.abort()} aria-label="Stop"><Square size={16} /></Button>
          ) : (
            <Button type="submit" className="h-11" disabled={!input.trim() || !online} aria-label="Send"><Send size={16} /></Button>
          )}
        </form>
      </div>
    </div>
  );
}

function Bubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  return (
    <div className={cn("flex", role === "user" ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[88%]", role === "user" ? "rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-accent-ink" : "rounded-2xl rounded-bl-md border border-border bg-bg px-3.5 py-1")}>
        {role === "user" ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{content}</p> : <Markdown>{content}</Markdown>}
      </div>
    </div>
  );
}
