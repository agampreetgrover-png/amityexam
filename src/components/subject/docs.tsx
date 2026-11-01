"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight, FileText, Loader2, Printer, Save, Square, Trash2, X } from "lucide-react";
import { db } from "@/lib/db";
import { aiStream } from "@/lib/ai/client";
import type { AiRequest, TextAction } from "@/lib/ai/schemas";
import type { GeneratedDoc } from "@/lib/types";
import { Markdown } from "../markdown";
import { Badge, Button, Card, cn } from "../ui";
import { isAbort } from "./shared";

/** Streams a text action into state and supports cancelling. */
export function useStreamDoc() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ctrl = useRef<AbortController | null>(null);
  // Leaving the tab cancels the stream, so it can't keep using AI quota or save a doc nobody is waiting for.
  useEffect(() => () => ctrl.current?.abort(), []);

  const run = async (action: TextAction, body: AiRequest): Promise<string | null> => {
    ctrl.current = new AbortController();
    setBusy(true);
    setError(null);
    setText("");
    try {
      return await aiStream(action, body, setText, ctrl.current.signal);
    } catch (e) {
      if (!isAbort(e)) setError(e);
      return null;
    } finally {
      setBusy(false);
      ctrl.current = null;
    }
  };

  const stop = () => ctrl.current?.abort();
  return { text, busy, error, run, stop, reset: () => setText("") };
}

/** Saves a generated doc and returns it as stored, ready for the viewer. */
export async function saveDoc(doc: Omit<GeneratedDoc, "id" | "createdAt">): Promise<GeneratedDoc> {
  const full = { ...doc, createdAt: Date.now() };
  const id = await db.docs.add(full);
  return { ...full, id };
}

/**
 * The streaming text while it's written. After Stop or a dropped connection the text is still here,
 * so it can be kept with "Save draft" instead of vanishing on the next generate.
 */
export function DraftCard({ gen, busyTitle, onSave }: { gen: ReturnType<typeof useStreamDoc>; busyTitle: string; onSave: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  if (!gen.busy && !gen.text) return null;
  const canSave = !gen.busy && !!gen.text.trim();
  return (
    <Card
      title={
        gen.busy ? (
          // A spinner beside the title while the AI writes, so the card reads as working even before the first words land.
          <span className="inline-flex items-center gap-2">
            <Loader2 size={15} className="animate-spin text-accent motion-reduce:animate-none" aria-hidden /> {busyTitle}
          </span>
        ) : "Unfinished draft"
      }
      className="tab-in no-print"
      action={canSave && (
        <Button
          size="sm"
          variant="secondary"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try { await onSave(); } finally { setSaving(false); }
          }}
        >
          {saving ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Save size={14} />} {saving ? "Saving…" : "Save draft"}
        </Button>
      )}
    >
      {canSave && <p className="mb-4 rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 text-[13px] text-muted">Writing stopped before the end. Save what&apos;s here, or generate again.</p>}
      <div aria-busy={gen.busy}>
        {/* Before the first words arrive: the same rising dots as the chat, rather than a lone ellipsis. */}
        {gen.text ? <Markdown>{gen.text}</Markdown> : <span aria-hidden className="thinking-dots text-faint"><span /><span /><span /></span>}
      </div>
    </Card>
  );
}

/** Takes the generate button's place while the AI writes. A filled square, as in the chat's dock: an outline read as a checkbox. */
export const StopButton = ({ onClick }: { onClick: () => void }) => (
  <Button variant="secondary" onClick={onClick}><Square size={11} className="fill-current" aria-hidden /> Stop</Button>
);

const KIND_LABEL: Record<GeneratedDoc["kind"], string> = { summary: "Notes", cheatsheet: "Cheat sheet", predict: "Prediction" };

/** List of saved generated docs; clicking one opens it in the viewer. */
export function DocList({ docs, selected, onSelect }: { docs: GeneratedDoc[]; selected?: number; onSelect: (d: GeneratedDoc) => void }) {
  return (
    <ul className="no-print divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface shadow-sheet">
      {docs.map((d) => (
        <li key={d.id}>
          <button
            type="button"
            onClick={() => onSelect(d)}
            aria-current={selected === d.id ? "true" : undefined}
            className={cn(
              // The ring sits inside the row, since the list's rounded clip would cut an outside one off.
              "group flex w-full items-start gap-3 px-4 py-3 text-left text-[15px] transition-colors duration-150 hover:bg-surface-2 focus-visible:-outline-offset-2 sm:items-center sm:px-5",
              // The open doc: a quiet fill like the nav's active item, with its icon in the accent.
              selected === d.id && "bg-nav-active font-medium text-nav-active-ink hover:bg-nav-active",
            )}
          >
            <FileText size={16} className={cn("mt-0.5 shrink-0 transition-colors duration-150 sm:mt-0", selected === d.id ? "text-accent" : "text-faint group-hover:text-muted")} aria-hidden />
            {/* Phones: the date goes under the title, and a long title wraps to two lines instead of being cut short. */}
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 break-words">{d.title}</span>
              <span className="mt-0.5 block text-xs font-normal tabular-nums text-muted sm:hidden">{new Date(d.createdAt).toLocaleDateString()}</span>
            </span>
            <Badge tone={d.kind === "predict" ? "accent" : "neutral"} className="hidden sm:inline-flex">{KIND_LABEL[d.kind]}</Badge>
            <span className="hidden shrink-0 text-xs font-normal tabular-nums text-muted sm:inline">{new Date(d.createdAt).toLocaleDateString()}</span>
            <ChevronRight
              size={16}
              aria-hidden
              className={cn(
                "mt-0.5 shrink-0 transition-[transform,color] duration-200 ease-snappy sm:mt-0",
                // The open one's arrow turns toward the viewer above it.
                selected === d.id ? "-rotate-90 text-accent" : "text-faint group-hover:translate-x-0.5 group-hover:text-muted",
              )}
            />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Printable viewer for a saved doc. Everything else on the page is marked no-print. */
export function DocViewer({ doc, onDeleted, onClose }: { doc: GeneratedDoc; onDeleted: () => void; onClose: () => void }) {
  // The viewer sits above the saved list; opening a doc from far down the list would otherwise look like nothing happened.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [doc.id]);
  return (
    // Keyed by the doc, so opening another one settles it in fresh rather than swapping the text under the reader.
    <div key={doc.id} ref={ref} className="tab-in scroll-mt-4">
      <Card
        // The open document gets a larger title than the Card's own section heading. Long titles wrap; the actions stay put.
        title={<span className="block min-w-0 break-words font-display text-[21px] leading-tight md:text-[24px]">{doc.title}</span>}
        action={
          <div className="no-print -mr-1.5 flex shrink-0 self-start">
            <Button variant="ghost" size="icon" onClick={() => window.print()} aria-label="Print" title="Print"><Printer size={15} /></Button>
            <Button
              variant="danger"
              size="icon"
              title="Delete"
              aria-label="Delete"
              onClick={async () => {
                if (!confirm("Delete this document?")) return;
                await db.docs.delete(doc.id);
                onDeleted();
              }}
            >
              <Trash2 size={14} />
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" title="Close"><X size={16} /></Button>
          </div>
        }
      >
        <Markdown>{doc.content}</Markdown>
      </Card>
    </div>
  );
}
