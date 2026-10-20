"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Check, Layers, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { today } from "@/lib/dates";
import { NEW_SRS } from "@/lib/srs";
import { retrieve } from "@/lib/retrieve";
import { aiJson } from "@/lib/ai/client";
import type { Flashcard } from "@/lib/types";
import { AiErrorBox } from "../ai-error";
import { Button, Card, Empty, Field, List, Select, Textarea } from "../ui";
import { noteTexts, OfflineHint, topicQuery, TopicSelect, useMaterials, useOnline, type TabProps } from "./shared";

export function FlashcardsTab({ subject, units, topics }: TabProps) {
  const subjectId = subject.id!;
  const online = useOnline();
  const [topicId, setTopicId] = useState("");
  const [count, setCount] = useState(15);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);

  const materials = useMaterials(subjectId);
  const cards = useLiveQuery(() => db.flashcards.where({ subjectId }).toArray(), [subjectId]) ?? [];
  const shown = filter ? cards.filter((c) => String(c.topicId ?? "") === filter) : cards;
  const due = cards.filter((c) => c.due <= today()).length;

  const generate = async () => {
    const topic = topics.find((t) => String(t.id) === topicId);
    if (!topic) return;
    setBusy(true);
    setError(null);
    try {
      const context = retrieve(noteTexts(materials), topicQuery(topic, units), 12_000);
      const res = await aiJson("flashcards", { subject: subject.name, topics: [topic.title], context, count });
      const d = today();
      const fresh = res.cards
        .map((c) => ({ front: c.front.trim(), back: c.back.trim() }))
        .filter((c) => c.front && c.back);
      if (!fresh.length) throw new Error("The AI returned no usable cards. Try again.");
      await db.flashcards.bulkAdd(fresh.map((c) => ({ subjectId, topicId: topic.id, ...c, ...NEW_SRS, due: d })));
      setFilter(String(topic.id));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const topicName = (id?: number) => topics.find((t) => t.id === id)?.title;

  return (
    <div className="space-y-8">
      <Card>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <Field label="Topic"><TopicSelect units={units} topics={topics} value={topicId} onChange={setTopicId} allowAll={false} /></Field>
          <Field label="Cards">
            <Select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[10, 15, 25].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Field>
          <Button onClick={generate} disabled={busy || !topicId || !online}>
            <Sparkles size={16} /> {busy ? "Making cards…" : "Make cards"}
          </Button>
        </div>
        <div className="mt-2 space-y-2"><OfflineHint online={online} /><AiErrorBox error={error} /></div>
      </Card>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-baseline gap-2 text-[15px] font-semibold">
            {cards.length} cards
            {due > 0 && <span className="mark text-[13px] font-medium">{due} due today</span>}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <TopicSelect units={units} topics={topics} value={filter} onChange={setFilter} className="h-8 w-auto max-w-48 text-xs" />
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)}><Plus size={14} /> Add card</Button>
            <Link href="/revise" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-[13px] font-medium text-accent-ink hover:opacity-90">
              <Layers size={14} /> Review
            </Link>
          </div>
        </div>

        {adding && (
          <div className="mb-3">
            <CardEditor
              initial={{ front: "", back: "" }}
              onCancel={() => setAdding(false)}
              onSave={async (front, back) => {
                await db.flashcards.add({ subjectId, topicId: filter ? Number(filter) : undefined, front, back, ...NEW_SRS, due: today() });
                setAdding(false);
              }}
            />
          </div>
        )}

        {shown.length === 0 ? (
          <Empty icon={<Layers />} title="No flashcards">Make cards for a topic with AI, or add your own.</Empty>
        ) : (
          <List>
            {shown.map((c) => <CardRow key={c.id} card={c} topic={topicName(c.topicId)} />)}
          </List>
        )}
      </section>
    </div>
  );
}

function CardRow({ card, topic }: { card: Flashcard; topic?: string }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <li className="py-3">
        <CardEditor
          initial={card}
          onCancel={() => setEditing(false)}
          onSave={async (front, back) => { await db.flashcards.update(card.id!, { front, back }); setEditing(false); }}
        />
      </li>
    );
  }
  return (
    <li className="flex items-start gap-2 py-3.5">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-[15px] font-medium">{card.front}</p>
        <p className="text-sm leading-relaxed text-muted">{card.back}</p>
        <p className="flex flex-wrap gap-x-3 text-xs text-muted">
          {topic && <span>{topic}</span>}
          <span>Due {card.due}</span>
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={() => setEditing(true)} aria-label="Edit"><Pencil size={13} /></Button>
      <Button variant="danger" size="sm" onClick={() => db.flashcards.delete(card.id!)} aria-label="Delete"><Trash2 size={13} /></Button>
    </li>
  );
}

function CardEditor({ initial, onSave, onCancel }: { initial: { front: string; back: string }; onSave: (f: string, b: string) => Promise<void>; onCancel: () => void }) {
  const [front, setFront] = useState(initial.front);
  const [back, setBack] = useState(initial.back);
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="space-y-2 rounded-2xl border border-text/30 bg-surface p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (saving) return; // a double tap would otherwise add the card twice
        setSaving(true);
        try {
          await onSave(front.trim(), back.trim());
        } finally {
          setSaving(false);
        }
      }}
    >
      <Textarea placeholder="Front: question or term" value={front} onChange={(e) => setFront(e.target.value)} className="min-h-16" autoFocus />
      <Textarea placeholder="Back: answer" value={back} onChange={(e) => setBack(e.target.value)} className="min-h-16" />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={saving || !front.trim() || !back.trim()}><Check size={14} /> Save card</Button>
      </div>
    </form>
  );
}
