"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { db } from "@/lib/db";
import { refreshWeak } from "@/lib/weak";
import { extractAny } from "@/lib/pdf";
import { aiJson } from "@/lib/ai/client";
import type { SyllabusResult } from "@/lib/ai/schemas";
import type { Topic, TopicStatus, Unit } from "@/lib/types";
import { AiErrorBox } from "../ai-error";
import { Badge, Button, Dots, Empty, Input, List, Modal, Section, Select, Textarea } from "../ui";
import { MAX_TEXT, OfflineHint, useOnline, type TabProps } from "./shared";

const newTopic = (subjectId: number, unitId: number, title: string, difficulty = 3): Topic => ({
  subjectId, unitId, title, difficulty: Math.min(5, Math.max(1, Math.round(difficulty))), confidence: 3,
  status: "not-started", ease: 2.5, interval: 0, reps: 0,
});

/**
 * Remove topics and everything pointing at them in one transaction.
 * Exams drop the ids from their syllabus; left behind, an exam listing only deleted
 * topics would cover nothing (an empty list means "whole subject" to the planner).
 * Flashcards are kept but unlinked.
 */
async function deleteTopics(ids: number[], unitId?: number) {
  await db.transaction("rw", [db.units, db.topics, db.sessions, db.flashcards, db.exams], async () => {
    await db.sessions.where("topicId").anyOf(ids).delete();
    await db.flashcards.where("topicId").anyOf(ids).modify({ topicId: undefined });
    await db.exams
      .filter((e) => e.topicIds.some((id) => ids.includes(id)))
      .modify((e) => { e.topicIds = e.topicIds.filter((id) => !ids.includes(id)); });
    await db.topics.bulkDelete(ids);
    if (unitId != null) await db.units.delete(unitId);
  });
}

export function SyllabusTab({ subject, units, topics }: TabProps) {
  const [importOpen, setImportOpen] = useState(false);
  const [newUnit, setNewUnit] = useState("");

  const addUnit = async () => {
    if (!newUnit.trim()) return;
    await db.units.add({ subjectId: subject.id!, title: newUnit.trim(), order: units.length });
    setNewUnit("");
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-2">
        <form className="flex min-w-0 flex-1 basis-64 gap-2" onSubmit={(e) => { e.preventDefault(); addUnit(); }}>
          <Input placeholder="New unit or module name" value={newUnit} onChange={(e) => setNewUnit(e.target.value)} />
          <Button type="submit" variant="secondary" className="shrink-0 whitespace-nowrap" disabled={!newUnit.trim()}><Plus size={16} /> Add unit</Button>
        </form>
        <Button onClick={() => setImportOpen(true)}><Sparkles size={16} /> Import with AI</Button>
      </div>

      {units.length === 0 ? (
        <Empty title="No syllabus yet">Add units by hand, or import the syllabus from a PDF or pasted text with AI.</Empty>
      ) : (
        units.map((u) => <UnitSection key={u.id} unit={u} topics={topics.filter((t) => t.unitId === u.id)} />)
      )}

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import syllabus with AI">
        <ImportSyllabus subjectId={subject.id!} subjectName={subject.name} unitCount={units.length} onDone={() => setImportOpen(false)} />
      </Modal>
    </div>
  );
}

function UnitSection({ unit, topics }: { unit: Unit; topics: Topic[] }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(unit.title);
  const [newT, setNewT] = useState("");

  const remove = async () => {
    if (!confirm(`Delete "${unit.title}" and its ${topics.length} topics?`)) return;
    await deleteTopics(topics.map((t) => t.id!), unit.id!);
  };

  // Re-seed the draft each time so a rename made elsewhere isn't overwritten by a stale value.
  const toggleEdit = () => {
    setTitle(unit.title);
    setEditing(!editing);
  };

  return (
    <Section
      title={
        editing ? (
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (title.trim()) await db.units.update(unit.id!, { title: title.trim() });
              setEditing(false);
            }}
          >
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-8" autoFocus />
            <Button size="sm" type="submit" aria-label="Save"><Check size={14} /></Button>
          </form>
        ) : (
          <span className="flex items-baseline gap-2">
            {unit.title}
            <span className="text-[13px] font-normal text-muted">{topics.length} topics</span>
          </span>
        )
      }
      action={
        <div className="flex shrink-0">
          <Button variant="ghost" size="sm" onClick={toggleEdit} aria-label="Rename unit"><Pencil size={14} /></Button>
          <Button variant="danger" size="sm" onClick={remove} aria-label="Delete unit"><Trash2 size={14} /></Button>
        </div>
      }
    >
      {topics.length > 0 && (
        <List>
          {topics.map((t) => <TopicRow key={t.id} topic={t} />)}
        </List>
      )}
      <form
        className="mt-3 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!newT.trim()) return;
          await db.topics.add(newTopic(unit.subjectId, unit.id!, newT.trim()));
          setNewT("");
        }}
      >
        <Input placeholder="Add a topic" value={newT} onChange={(e) => setNewT(e.target.value)} className="h-9" />
        <Button size="sm" variant="secondary" type="submit" className="h-9" disabled={!newT.trim()} aria-label="Add topic"><Plus size={14} /></Button>
      </form>
    </Section>
  );
}

function TopicRow({ topic }: { topic: Topic }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(topic.title);
  const id = topic.id!;

  const remove = async () => {
    if (confirm(`Delete topic "${topic.title}"?`)) await deleteTopics([id]);
  };

  const toggleEdit = () => {
    setTitle(topic.title);
    setEditing(!editing);
  };

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1 basis-48">
        {editing ? (
          <form
            className="flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (title.trim()) await db.topics.update(id, { title: title.trim() });
              setEditing(false);
            }}
          >
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-8" autoFocus />
            <Button size="sm" type="submit" aria-label="Save"><Check size={14} /></Button>
          </form>
        ) : (
          <span className="text-[15px]">
            {topic.title} {topic.weak && <Badge className="ml-1 bg-bad/10 text-bad">weak</Badge>}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">Difficulty <Dots label="Difficulty" value={topic.difficulty} onChange={(v) => db.topics.update(id, { difficulty: v })} /></span>
        <span className="flex items-center gap-1.5">
          Confidence
          <Dots label="Confidence" value={topic.confidence} onChange={async (v) => { await db.topics.update(id, { confidence: v }); await refreshWeak([id]); }} />
        </span>
        <Select
          value={topic.status}
          onChange={(e) => db.topics.update(id, { status: e.target.value as TopicStatus })}
          className="h-8 w-auto py-0 text-xs"
          aria-label="Status"
        >
          <option value="not-started">Not started</option>
          <option value="studied">Studied</option>
          <option value="revised">Revised</option>
        </Select>
        <span className="flex">
          <Button variant="ghost" size="sm" onClick={toggleEdit} aria-label="Rename topic"><Pencil size={13} /></Button>
          <Button variant="danger" size="sm" onClick={remove} aria-label="Delete topic"><Trash2 size={13} /></Button>
        </span>
      </div>
    </li>
  );
}

function ImportSyllabus({ subjectId, subjectName, unitCount, onDone }: { subjectId: number; subjectName: string; unitCount: number; onDone: () => void }) {
  const online = useOnline();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [draft, setDraft] = useState<SyllabusResult["units"] | null>(null);
  const [reading, setReading] = useState("");
  const [saving, setSaving] = useState(false);

  const onFile = async (f?: File) => {
    if (!f) return;
    setError(null);
    setReading(`Reading ${f.name}…`);
    try {
      setText(await extractAny(f, { onStatus: setReading }));
    } catch (e) {
      setError(e);
    } finally {
      setReading("");
    }
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await aiJson("syllabus", { subject: subjectName, text: text.slice(0, MAX_TEXT) });
      setDraft(res.units);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setError(null);
    try {
      await db.transaction("rw", db.units, db.topics, async () => {
        let order = unitCount;
        for (const u of draft) {
          // Skip units left with no named topics after review instead of creating empty ones.
          const named = u.topics.filter((t) => t.title.trim());
          if (!u.title.trim() || !named.length) continue;
          const unitId = (await db.units.add({ subjectId, title: u.title.trim(), order: order++ })) as number;
          await db.topics.bulkAdd(named.map((t) => newTopic(subjectId, unitId, t.title.trim(), t.difficulty)));
        }
      });
      onDone();
    } catch (e) {
      setError(e);
      setSaving(false);
    }
  };

  // Immutable updates on the draft tree.
  const editUnit = (i: number, patch: Partial<SyllabusResult["units"][number]>) =>
    setDraft((d) => d!.map((u, j) => (j === i ? { ...u, ...patch } : u)));

  if (draft) {
    const count = draft.reduce((a, u) => a + u.topics.length, 0);
    return (
      <div className="space-y-5">
        <p className="text-sm text-muted">Check {draft.length} units and {count} topics before saving. Fix names, adjust difficulty and remove anything wrong.</p>
        {draft.map((u, i) => (
          <div key={i}>
            <div className="mb-2 flex gap-2">
              <Input value={u.title} onChange={(e) => editUnit(i, { title: e.target.value })} className="h-9 font-semibold" />
              <Button variant="danger" size="sm" className="h-9" onClick={() => setDraft(draft.filter((_, j) => j !== i))} aria-label="Remove unit"><Trash2 size={14} /></Button>
            </div>
            <ul className="space-y-1.5 border-l border-border pl-3">
              {u.topics.map((t, k) => (
                <li key={k} className="flex items-center gap-2">
                  <Input
                    value={t.title}
                    onChange={(e) => editUnit(i, { topics: u.topics.map((x, m) => (m === k ? { ...x, title: e.target.value } : x)) })}
                    className="h-8 text-xs"
                  />
                  <Dots label="Difficulty" value={t.difficulty} onChange={(v) => editUnit(i, { topics: u.topics.map((x, m) => (m === k ? { ...x, difficulty: v } : x)) })} />
                  <Button variant="ghost" size="sm" onClick={() => editUnit(i, { topics: u.topics.filter((_, m) => m !== k) })} aria-label="Remove topic"><Trash2 size={13} /></Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <AiErrorBox error={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDraft(null)}>Back</Button>
          <Button onClick={save} disabled={saving || !count}>Save {count} topics</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border p-5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-text">
        <Upload size={16} /> Upload the syllabus as a PDF, photo or text file
        <input
          type="file"
          accept="application/pdf,.txt,.md,image/*"
          className="hidden"
          disabled={!!reading}
          onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }}
        />
      </label>
      {reading && <p className="text-sm font-medium">{reading}</p>}
      <Textarea placeholder="Or paste the syllabus text here" value={text} onChange={(e) => setText(e.target.value)} className="min-h-48 text-xs" />
      <AiErrorBox error={error} />
      <OfflineHint online={online} />
      <div className="flex justify-end">
        <Button onClick={run} disabled={busy || !!reading || !text.trim() || !online}>
          <Sparkles size={16} /> {busy ? "Reading syllabus…" : "Extract topics"}
        </Button>
      </div>
    </div>
  );
}
