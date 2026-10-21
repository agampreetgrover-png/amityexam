"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { db } from "@/lib/db";
import { refreshWeak } from "@/lib/weak";
import { extractAny } from "@/lib/pdf";
import { aiJson } from "@/lib/ai/client";
import type { SyllabusResult } from "@/lib/ai/schemas";
import type { ExamMode, Topic, TopicStatus, Unit } from "@/lib/types";
import { AiErrorBox } from "../ai-error";
import { Badge, Button, Card, Dots, Empty, Input, List, Modal, Select, Textarea, cn } from "../ui";
import { unitMode } from "@/lib/mode";
import { parseSyllabus, parseTopics } from "@/lib/syllabus-text";
import { MAX_TEXT, OfflineHint, useOnline, type TabProps } from "./shared";

const newTopic = (subjectId: number, unitId: number, title: string, difficulty = 3): Topic => ({
  subjectId, unitId, title, difficulty: Math.min(5, Math.max(1, Math.round(difficulty))), confidence: 3,
  status: "not-started", ease: 2.5, interval: 0, reps: 0,
});

/**
 * Remove topics and everything pointing at them in one transaction.
 * Exams drop the ids from their syllabus; left behind, an exam listing only deleted
 * topics would cover nothing (an empty list means "whole subject" to the planner).
 */
async function deleteTopics(ids: number[], unitId?: number) {
  await db.transaction("rw", [db.units, db.topics, db.sessions, db.exams, db.pyqQuestions], async () => {
    await db.sessions.where("topicId").anyOf(ids).delete();
    // Past-paper questions filed under these topics go back to "not matched yet" and get re-matched.
    await db.pyqQuestions.where("topicId").anyOf(ids).modify((q) => { delete q.topicId; });
    await db.exams
      .filter((e) => e.topicIds.some((id) => ids.includes(id)))
      .modify((e) => { e.topicIds = e.topicIds.filter((id) => !ids.includes(id)); });
    await db.topics.bulkDelete(ids);
    if (unitId != null) await db.units.delete(unitId);
  });
}

/** Next free order number. Counting units would reuse a number after a delete and make the order unstable. */
const nextOrder = (units: Unit[]) => units.reduce((max, u) => Math.max(max, u.order + 1), 0);

export function SyllabusTab({ subject, units, topics, mode }: TabProps) {
  const [importOpen, setImportOpen] = useState(false);
  // Kept here, not in the dialog: the dialog's content unmounts on close, and a reviewed draft cost an AI call.
  const [importText, setImportText] = useState("");
  const [importDraft, setImportDraft] = useState<Draft | null>(null);
  const [newUnit, setNewUnit] = useState("");
  const [adding, setAdding] = useState(false);
  const mid = mode === "mid-term";

  // One syllabus per subject. A unit added while preparing for the mid-sem is marked as in the mid-sem.
  const addUnit = async () => {
    const title = newUnit.trim();
    if (!title || adding) return; // a quick double Enter must not add the unit twice
    setAdding(true);
    try {
      await db.units.add({ subjectId: subject.id!, title, order: nextOrder(units), exam: mode });
      setNewUnit("");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <header className="mb-4">
          <h2 className="text-lg font-semibold">Syllabus</h2>
          <p className="text-[13px] text-muted">
            {mid
              ? "The full syllabus. Tick “In mid-sem” on the units your mid-sem covers; only those count while you prepare for it."
              : "The full syllabus for the major exam. Tick “In mid-sem” on the units the mid-sem covers."}
          </p>
        </header>

        <div className="flex flex-wrap gap-2">
          <form className="flex min-w-0 flex-1 basis-64 gap-2" onSubmit={(e) => { e.preventDefault(); addUnit(); }}>
            <Input placeholder="New unit or module name" value={newUnit} onChange={(e) => setNewUnit(e.target.value)} />
            <Button type="submit" variant="secondary" className="shrink-0 whitespace-nowrap" disabled={!newUnit.trim()}><Plus size={16} /> Add unit</Button>
          </form>
          <Button onClick={() => setImportOpen(true)}><Sparkles size={16} /> Import syllabus</Button>
        </div>
      </Card>

      {units.length === 0 ? (
        <Empty icon={<Upload />} title="Add this subject's syllabus">
          Import it from a PDF, photo or pasted text, or add units by hand. Then tick the units your mid-sem covers.
          <div className="mt-3"><Button size="sm" onClick={() => setImportOpen(true)}><Sparkles size={14} /> Import syllabus</Button></div>
        </Empty>
      ) : (
        units.map((u) => <UnitSection key={u.id} unit={u} topics={topics.filter((t) => t.unitId === u.id)} />)
      )}

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import syllabus">
        <ImportSyllabus
          subjectId={subject.id!}
          subjectName={subject.name}
          firstOrder={nextOrder(units)}
          mode={mode}
          text={importText}
          setText={setImportText}
          draft={importDraft}
          setDraft={setImportDraft}
          onDone={() => { setImportOpen(false); setImportText(""); setImportDraft(null); }}
        />
      </Modal>
    </div>
  );
}

function UnitSection({ unit, topics }: { unit: Unit; topics: Topic[] }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(unit.title);
  const [newT, setNewT] = useState("");
  const [adding, setAdding] = useState(false);

  const addTopics = async (titles: string[]) => {
    if (!titles.length || adding) return;
    setAdding(true);
    try {
      await db.topics.bulkAdd(titles.map((t) => newTopic(unit.subjectId, unit.id!, t)));
      setNewT("");
    } finally {
      setAdding(false);
    }
  };

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
    <Card
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
            <span className="text-[13px] font-normal text-muted">{topics.length} topic{topics.length === 1 ? "" : "s"}</span>
          </span>
        )
      }
      action={
        <div className="flex shrink-0 items-center">
          <label className="mr-1 flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-medium text-muted hover:bg-surface-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--accent)]"
              aria-label={`${unit.title} is in the mid-sem`}
              checked={unitMode(unit) === "mid-term"}
              onChange={(e) => db.units.update(unit.id!, { exam: e.target.checked ? "mid-term" : "end-term" })}
            />
            In mid-sem
          </label>
          <Button variant="ghost" size="sm" onClick={toggleEdit} aria-label="Rename unit"><Pencil size={14} /></Button>
          <Button variant="danger" size="sm" onClick={remove} aria-label="Delete unit"><Trash2 size={14} /></Button>
        </div>
      }
    >
      {topics.length > 0 && (
        <List className="border-t-0">
          {topics.map((t) => <TopicRow key={t.id} topic={t} />)}
        </List>
      )}
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newT.trim()) addTopics([newT.trim()]);
        }}
      >
        <Input
          placeholder="Add a topic, or paste a list"
          value={newT}
          onChange={(e) => setNewT(e.target.value)}
          // A one-line input would squash a pasted list into one topic; add each line instead.
          onPaste={(e) => {
            const lines = parseTopics(e.clipboardData.getData("text"));
            if (lines.length < 2) return;
            e.preventDefault();
            addTopics(lines);
          }}
          className="h-9"
        />
        <Button size="sm" variant="secondary" type="submit" className="h-9" disabled={!newT.trim()} aria-label="Add topic"><Plus size={14} /></Button>
      </form>
    </Card>
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
          className={cn(
            "h-8 w-auto py-0 text-xs font-medium",
            topic.status === "revised" ? "text-good" : topic.status === "studied" ? "text-accent" : "text-muted",
          )}
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

type Draft = SyllabusResult["units"];

function ImportSyllabus({ subjectId, subjectName, firstOrder, mode, onDone, text, setText, draft, setDraft }: {
  subjectId: number;
  subjectName: string;
  firstOrder: number;
  mode: ExamMode; // imported units join this mode's syllabus
  onDone: () => void;
  // Held by SyllabusTab, so closing the dialog by mistake doesn't throw away the pasted text or the reviewed draft.
  text: string;
  setText: (t: string) => void;
  draft: Draft | null;
  setDraft: React.Dispatch<React.SetStateAction<Draft | null>>;
}) {
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
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
    if (busy) return;
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

  // Works offline and when the AI's daily limit is used up.
  const splitHere = () => {
    const units = parseSyllabus(text);
    setError(null);
    if (units.length) setDraft(units);
    else setError(new Error("No topics found. Put each topic on its own line or separate them with commas."));
  };

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setError(null);
    try {
      await db.transaction("rw", db.units, db.topics, async () => {
        let order = firstOrder;
        for (const u of draft) {
          // Skip units left with no named topics after review instead of creating empty ones.
          const named = u.topics.filter((t) => t.title.trim());
          if (!u.title.trim() || !named.length) continue;
          const unitId = (await db.units.add({ subjectId, title: u.title.trim(), order: order++, exam: mode })) as number;
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
    // Count what save() will actually store: named topics under named units.
    const count = draft.reduce((a, u) => a + (u.title.trim() ? u.topics.filter((t) => t.title.trim()).length : 0), 0);
    return (
      <div className="space-y-5">
        <p className="text-sm text-muted">
          Check {draft.length} units and {count} topics before saving. Fix names, adjust difficulty and remove anything wrong.
          {mode === "mid-term" && " They'll be marked as in the mid-sem; untick any it doesn't cover after saving."}
        </p>
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
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border p-5 text-sm text-muted transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-accent">
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
      {!!error && !!text.trim() && <p className="text-[13px] text-muted">“Add without AI” splits the text into units and topics on this device.</p>}
      <OfflineHint online={online} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={splitHere} disabled={busy || !!reading || !text.trim()}>
          Add without AI
        </Button>
        <Button onClick={run} disabled={busy || !!reading || !text.trim() || !online}>
          <Sparkles size={16} /> {busy ? "Reading syllabus…" : "Extract topics"}
        </Button>
      </div>
    </div>
  );
}
