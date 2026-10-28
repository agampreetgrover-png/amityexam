"use client";

import { useEffect, useState } from "react";
import { ChatHistory } from "@/components/study-chat/history";
import { ChatThread } from "@/components/study-chat/thread";
import { PageHeader, cn } from "@/components/ui";

const COLLAPSED_KEY = "amityexams:chatHistoryCollapsed";

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
  // From tablets up the history can be folded away for a wider conversation; remembered on this device.
  const [collapsed, setCollapsedState] = useState(false);
  const setCollapsed = (v: boolean) => {
    setCollapsedState(v);
    try {
      localStorage.setItem(COLLAPSED_KEY, v ? "1" : "0");
    } catch {
      // storage unavailable; it just won't be remembered
    }
  };

  // Read once rather than with useSearchParams, which would remount the thread whenever the id changes.
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("id"));
    if (Number.isSafeInteger(id) && id > 0) setSelected(id);
    try {
      setCollapsedState(localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      // storage unavailable; the history shows
    }
    setReady(true);
  }, []);
  // The thread's History button: on a phone it swaps to the list, on a wider screen it unfolds the panel.
  const showHistory = () => (window.matchMedia("(min-width: 768px)").matches ? setCollapsed(false) : setHistoryOpen(true));
  const syncUrl = (id: number | null) => window.history.replaceState(window.history.state, "", id ? `/chat?id=${id}` : "/chat");

  const open = (id: number) => {
    // Already open (on a phone, tapping it in History to go back): remounting would cut off its answer.
    if (id === selected) return setHistoryOpen(false);
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
      />
      {ready && (
        // grid-cols-1 caps the phone column at the screen width; without it a wide table in an answer widens the whole page.
        // Phones scroll the page itself, like a messaging app: a fixed-height box there left the answer a thin strip
        // between the controls and the composer. From tablets up it's one sheet that fills the window: the history
        // down its left margin, the conversation beside it, each scrolling inside. The negative margin takes back
        // most of the page's bottom padding, which only leaves an empty band under a full-height sheet.
        <div
          className={cn(
            "grid grid-cols-1 gap-4 md:-mb-12 md:h-[calc(100dvh-12rem)] md:min-h-[28rem] md:gap-0 md:overflow-hidden md:rounded-xl md:border md:border-border md:bg-surface md:shadow-sheet",
            collapsed ? "md:grid-cols-[minmax(0,1fr)]" : "md:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)]",
          )}
        >
          <aside className={cn("min-h-0 md:border-r md:border-border md:bg-side", historyOpen ? "flex" : "hidden", collapsed ? "md:hidden" : "md:flex")} aria-label="Chat history">
            <ChatHistory selected={selected} onOpen={open} onNew={startNew} onClose={() => setHistoryOpen(false)} onCollapse={() => setCollapsed(true)} />
          </aside>
          <section className={cn("min-h-0 md:flex", historyOpen ? "hidden" : "flex")} aria-label="Conversation">
            <ChatThread
              key={threadKey}
              chatId={selected}
              onCreated={(id) => {
                setSelected(id);
                syncUrl(id);
              }}
              // Not startNew: remounting would lose the question the thread puts back in the box.
              onDiscarded={() => {
                setSelected(null);
                syncUrl(null);
              }}
              onGone={startNew}
              onShowHistory={showHistory}
              historyHidden={collapsed}
            />
          </section>
        </div>
      )}
    </>
  );
}
