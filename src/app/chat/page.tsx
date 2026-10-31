"use client";

import { useEffect, useState } from "react";
import { ChatHistory } from "@/components/study-chat/history";
import { ChatThread } from "@/components/study-chat/thread";
import { cn } from "@/components/ui";

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
  const [collapsed, setCollapsed] = useState(false);

  // Read once rather than with useSearchParams, which would remount the thread whenever the id changes.
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("id"));
    if (Number.isSafeInteger(id) && id > 0) setSelected(id);
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      // storage unavailable; the history shows
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      // storage unavailable; it just won't be remembered
    }
  }, [collapsed, ready]);
  // Ctrl+B / ⌘B folds the history away or brings it back (on a phone, swaps between it and the chat). Nothing
  // here is rich text, so taking the shortcut from a text box costs no bold.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.repeat || e.key.toLowerCase() !== "b" || e.defaultPrevented) return;
      e.preventDefault();
      if (window.matchMedia("(min-width: 768px)").matches) setCollapsed((c) => !c);
      else setHistoryOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
      {/* The two panels are the page: the conversation's own bar names the subject, so a big title would only push it down. */}
      <h1 className="sr-only">Chat</h1>
      {ready && (
        // data-full: the layout drops its column and padding, so this is the whole area under the top bar, edge to
        // edge, with no frame of its own: the history flush down the left (280px from xl; at lg the app's own wide
        // sidebar would squeeze the answer), the conversation filling the rest, each scrolling inside. grid-cols-1
        // caps the phone column at the screen width; without it a wide table in an answer widens the whole page.
        // Phones scroll the page itself, like a messaging app (a fixed-height box there left the answer a thin strip
        // between the controls and the composer), so there it's at least the screen under the top bar, padded clear
        // of the bottom bar.
        <div
          data-full
          className={cn(
            "grid min-h-[calc(100dvh-3.5rem)] grid-cols-1 px-4 pb-[calc(4.5rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 md:h-[calc(100dvh-4rem)] md:min-h-[28rem] md:overflow-hidden md:p-0",
            collapsed ? "md:grid-cols-[minmax(0,1fr)]" : "md:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[17.5rem_minmax(0,1fr)]",
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
