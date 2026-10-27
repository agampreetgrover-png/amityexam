"use client";

import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { ChatHistory } from "@/components/study-chat/history";
import { ChatThread } from "@/components/study-chat/thread";
import { Button, PageHeader, cn } from "@/components/ui";

/**
 * Study chat: answers grounded in the teacher's notes and past papers, pitched at the coming exam, with every
 * conversation kept in History. /chat?id=<n> opens a saved one (one precached page serves them all offline).
 */
export default function ChatPage() {
  const [selected, setSelected] = useState<number | null>(null);
  // Bumped to start a fresh thread. Not tied to `selected`: a new chat gets its id mid-answer, and remounting
  // then would cut the answer off.
  const [threadKey, setThreadKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false); // phones show the history or the chat, not both

  // Read once rather than with useSearchParams, which would remount the thread whenever the id changes.
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("id"));
    if (Number.isSafeInteger(id) && id > 0) setSelected(id);
    setReady(true);
  }, []);
  const syncUrl = (id: number | null) => window.history.replaceState(window.history.state, "", id ? `/chat?id=${id}` : "/chat");

  const open = (id: number) => {
    setSelected(id);
    setThreadKey((k) => k + 1);
    setHistoryOpen(false);
    syncUrl(id);
  };
  const startNew = () => {
    setSelected(null);
    setThreadKey((k) => k + 1);
    setHistoryOpen(false);
    syncUrl(null);
  };

  return (
    <>
      <PageHeader
        title="Chat"
        // Phones need the height for the conversation, so the explainer shows from tablets up.
        sub={<span className="hidden sm:inline">Ask anything. Answers come from your teacher&apos;s notes and past papers, pitched at your coming exam.</span>}
        action={<Button onClick={startNew} className="hidden md:inline-flex"><Plus size={16} /> New chat</Button>}
      />
      {ready && (
        <div className="grid h-[calc(100dvh-14rem)] min-h-[26rem] gap-4 md:h-[calc(100dvh-16.5rem)] md:grid-cols-[15rem_minmax(0,1fr)]">
          <aside className={cn("min-h-0 md:flex", historyOpen ? "flex" : "hidden")} aria-label="Chat history">
            <ChatHistory selected={selected} onOpen={open} onNew={startNew} onClose={() => setHistoryOpen(false)} />
          </aside>
          <section className={cn("min-h-0 md:flex", historyOpen ? "hidden" : "flex")} aria-label="Conversation">
            <ChatThread
              key={threadKey}
              chatId={selected}
              onCreated={(id) => {
                setSelected(id);
                syncUrl(id);
              }}
              onGone={startNew}
              onShowHistory={() => setHistoryOpen(true)}
            />
          </section>
        </div>
      )}
    </>
  );
}
