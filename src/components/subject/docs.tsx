"use client";

import { useRef, useState } from "react";
import { Printer, Square, Trash2 } from "lucide-react";
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

export const StopButton =({ onClick }: { onClick: () => void }) => (
  <Button variant="secondary" onClick={onClick}><Square size={14} /> Stop</Button>
);

const KIND_LABEL: Record<GeneratedDoc["kind"], string> = { summary: "Notes", cheatsheet: "Cheat sheet", predict: "Prediction" };

/** List of saved generated docs; clicking one opens it in the viewer. */
export function DocList({ docs, selected, onSelect }: { docs: GeneratedDoc[]; selected?: number; onSelect: (d: GeneratedDoc) => void }) {
  return (
    <ul className="no-print divide-y divide-border border-y border-border">
      {docs.map((d) => (
        <li key={d.id}>
          <button
            onClick={() => onSelect(d)}
            aria-current={selected === d.id ? "true" : undefined}
            className={cn(
              "-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-3 text-left text-[15px] transition-colors hover:bg-surface-2",
              selected === d.id && "bg-accent-soft font-semibold",
            )}
          >
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
  return (
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
  );
}
