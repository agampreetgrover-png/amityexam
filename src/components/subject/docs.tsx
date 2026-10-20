"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Printer, Save, Square, Trash2 } from "lucide-react";
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
      title={gen.busy ? busyTitle : "Unfinished draft"}
      className="no-print"
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
          <Save size={14} /> {saving ? "Saving…" : "Save draft"}
        </Button>
      )}
    >
      {canSave && <p className="mb-2 text-xs text-muted">Writing stopped before the end. Save what&apos;s here, or generate again.</p>}
      <Markdown>{gen.text || "…"}</Markdown>
    </Card>
  );
}

export const StopButton = ({ onClick }: { onClick: () => void }) => (
  <Button variant="secondary" onClick={onClick}><Square size={14} /> Stop</Button>
);

const KIND_LABEL: Record<GeneratedDoc["kind"], string> = { summary: "Notes", cheatsheet: "Cheat sheet", predict: "Prediction" };

/** List of saved generated docs; clicking one opens it in the viewer. */
export function DocList({ docs, selected, onSelect }: { docs: GeneratedDoc[]; selected?: number; onSelect: (d: GeneratedDoc) => void }) {
  return (
    <ul className="no-print divide-y divide-border">
      {docs.map((d) => (
        <li key={d.id}>
          <button
            onClick={() => onSelect(d)}
            aria-current={selected === d.id ? "true" : undefined}
            className={cn(
              "-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-3 text-left text-[15px] transition-colors hover:bg-surface-2",
              selected === d.id && "bg-accent-soft font-semibold text-accent hover:bg-accent-soft",
            )}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent" aria-hidden>
              <FileText size={15} />
            </span>
            <span className="min-w-0 flex-1 truncate">{d.title}</span>
            <Badge className="hidden sm:inline-flex">{KIND_LABEL[d.kind]}</Badge>
            <span className="shrink-0 text-xs font-normal text-muted">{new Date(d.createdAt).toLocaleDateString()}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Printable viewer for a saved doc. Everything else on the page is marked no-print. */
export function DocViewer({ doc, onDeleted }: { doc: GeneratedDoc; onDeleted: () => void }) {
  // The viewer sits above the saved list; opening a doc from far down the list would otherwise look like nothing happened.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, [doc.id]);
  return (
    <div ref={ref} className="scroll-mt-4">
    <Card
      title={doc.title}
      action={
        <div className="no-print flex shrink-0">
          <Button variant="ghost" size="sm" onClick={() => window.print()} aria-label="Print"><Printer size={14} /></Button>
          <Button
            variant="danger"
            size="sm"
            aria-label="Delete"
            onClick={async () => {
              if (!confirm("Delete this document?")) return;
              await db.docs.delete(doc.id!);
              onDeleted();
            }}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      }
    >
      <Markdown>{doc.content}</Markdown>
    </Card>
    </div>
  );
}
