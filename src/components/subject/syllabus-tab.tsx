"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { db } from "@/lib/db";
import { extractAny } from "@/lib/pdf";
import { aiJson } from "@/lib/ai/client";
import type { SyllabusResult } from "@/lib/ai/schemas";
import type { ExamMode, Topic, TopicStatus, Unit } from "@/lib/types";
import { AiErrorBox } from "../ai-error";
import { toast } from "../toast";
import { Badge, Button, Card, Empty, Input, Modal, Panel, Textarea, cn } from "../ui";
import { unitInScope } from "@/lib/mode";
import { newTopic, parseSyllabus, parseTopics } from "@/lib/syllabus-text";
import { MAX_TEXT, OfflineHint, useOnline, type TabProps } from "./shared";

/**
 * Remove topics and everything pointing at them in one transaction.
 * Exams drop the ids from their syllabus; left behind, an exam listing only deleted
 * topics would cover nothing (an empty list means "whole subject").
 */
async function deleteTopics(ids: number[], unitId?: number) {
  await db.transaction("rw", [db.units, db.topics, db.exams, db.pyqQuestions], async () => {
    // Past-paper questions filed under these topics go back to "not matched yet" and get re-matched.
    await db.pyqQuestions.where("topicId").anyOf(ids).modify((q) => { delete q.topicId; });
    await db.exams
      .filter((e) => e.topicIds.some((id) => ids.includes(id)))
      .modify((e) => { e.topicIds = e.topicIds.filter((id) => !ids.includes(id)); });
    await db.topics.bulkDelete(ids);
    if (unitId != null) await db.units.delete(unitId);
  });
}

const SAVE_FAILED = "Couldn't save that. Try again.";

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
  // Only this mode's units are listed; `units` stays complete so new units are numbered after every existing one.
  const shown = units.filter((u) => unitInScope(u, mode));

  // A unit belongs to the syllabus of the mode it was added in.
  const addUnit = async () => {
    const title = newUnit.trim();
    if (!title || adding) return; // a quick double Enter must not add the unit twice
    setAdding(true);
    try {
      await db.units.add({ subjectId: subject.id!, title, order: nextOrder(units), exam: mode });
      setNewUnit("");
    } catch {
      toast(SAVE_FAILED);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <header className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1 basis-64">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{mid ? "Mid-sem syllabus" : "Major syllabus"}</h2>
            <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted">
              {mid
                ? "Units you add or import while preparing for the mid-sem count towards it."
                : "The full syllabus for the major exam."}
            </p>
          </div>
          <Button onClick={() => setImportOpen(true)} className="shrink-0"><Sparkles size={16} /> Import syllabus</Button>
        </header>
        <form className="flex min-w-0 gap-2" onSubmit={(e) => { e.preventDefault(); addUnit(); }}>
          <Input placeholder="New unit or module name" value={newUnit} onChange={(e) => setNewUnit(e.target.value)} aria-label="New unit name" />
          <Button type="submit" variant="secondary" className="shrink-0 whitespace-nowrap" disabled={!newUnit.trim()}><Plus size={16} /> Add unit</Button>
        </form>
      </Card>

      {shown.length === 0 ? (
        <Empty icon={<Upload size={20} />} title="Add this subject's syllabus">
          Import it from a PDF, photo or pasted text, or add units by hand.
          <div className="mt-3"><Button size="sm" onClick={() => setImportOpen(true)}><Sparkles size={14} /> Import syllabus</Button></div>
        </Empty>
      ) : (
        shown.map((u) => <UnitSection key={u.id} unit={u} topics={topics.filter((t) => t.unitId === u.id)} />)
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
  const [newT, setNewT] = useState("");
  const [adding, setAdding] = useState(false);

  const addTopics = async (titles: string[]) => {
    if (!titles.length || adding) return;
    setAdding(true);
    try {
      await db.topics.bulkAdd(titles.map((t) => newTopic(unit.subjectId, unit.id!, t)));
      setNewT("");
    } catch {
      toast(SAVE_FAILED);
    } finally {
      setAdding(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete "${unit.title}" and its ${topics.length} topic${topics.length === 1 ? "" : "s"}?`)) return;
    await deleteTopics(topics.map((t) => t.id!), unit.id).catch(() => toast(SAVE_FAILED));
  };

  const done = topics.filter((t) => t.status === "revised").length;

  // A unit is one sheet: its heading and controls, its topics as ruled rows, and a line to add more at the foot.
  return (
    <Panel as="section">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border py-3 pl-5 pr-3">
        <h2 className="min-w-0 flex-1 basis-56 text-[15px] font-semibold tracking-[-0.01em]">
          {editing ? (
            <InlineRename heading name={unit.title} label="Unit name" onSave={(title) => db.units.update(unit.id, { title })} onDone={() => setEditing(false)} />
          ) : (
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="min-w-0 break-words">{unit.title}</span>
              <span className="flex gap-1.5 tracking-normal">
                <Badge>{topics.length} topic{topics.length === 1 ? "" : "s"}</Badge>
                {done > 0 && <Badge tone="good">{done} revised</Badge>}
              </span>
            </span>
          )}
        </h2>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button variant="ghost" size="icon" onClick={() => setEditing(!editing)} aria-label="Rename unit" title="Rename unit"><Pencil size={14} /></Button>
          <Button variant="danger" size="icon" onClick={remove} aria-label="Delete unit" title="Delete unit"><Trash2 size={14} /></Button>
        </div>
      </div>
      {topics.length > 0 && (
        <ul className="divide-y divide-border">
          {topics.map((t) => <TopicRow key={t.id} topic={t} />)}
        </ul>
      )}
      <form
        className="flex items-center gap-2 border-t border-border bg-surface-2/40 py-2 pl-3 pr-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (newT.trim()) addTopics([newT.trim()]);
        }}
      >
        <Plus size={15} className="ml-1.5 shrink-0 text-faint" aria-hidden />
        <Input
          placeholder="Add a topic, or paste a list"
          aria-label={`Add a topic to ${unit.title}`}
          value={newT}
          onChange={(e) => setNewT(e.target.value)}
          // A one-line input would squash a pasted list into one topic; add each line instead.
          onPaste={(e) => {
            const lines = parseTopics(e.clipboardData.getData("text"));
            if (lines.length < 2) return;
            e.preventDefault();
            addTopics(lines);
          }}
          className="h-9 border-transparent bg-transparent px-1.5 shadow-none hover:border-transparent focus:border-accent focus:bg-surface"
        />
        <Button size="sm" variant="secondary" type="submit" className="shrink-0" disabled={!newT.trim()}>Add</Button>
      </form>
    </Panel>
  );
}

/**
 * A unit's or topic's name, edited in place. It mounts fresh each time, so the draft starts from the current
 * name and a rename made elsewhere isn't overwritten by a stale value. A failed save keeps it open to try again.
 */
function InlineRename({ name, label, heading, onSave, onDone }: {
  name: string;
  label: string;
  /** A unit's heading: a taller, bold field. */
  heading?: boolean;
  onSave: (title: string) => Promise<unknown>;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(name);
  return (
    <form
      className="flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (title.trim()) {
          try {
            await onSave(title.trim());
          } catch {
            toast(SAVE_FAILED);
            return;
          }
        }
        onDone();
      }}
    >
      <Input value={title} onChange={(e) => setTitle(e.target.value)} className={heading ? "h-9 font-semibold" : "h-8"} autoFocus aria-label={label} />
      <Button size={heading ? "md" : "icon"} type="submit" aria-label="Save name"><Check size={heading ? 15 : 14} /></Button>
    </form>
  );
}

// The same tints as Badge's neutral, accent and good tones, so a status reads like the app's other labels.
const STATUS_TONE: Record<TopicStatus, { pill: string; dot: string }> = {
  "not-started": { pill: "border-border bg-surface-2 text-muted", dot: "bg-line-strong" },
  studied: { pill: "border-accent/20 bg-accent/10 text-accent", dot: "bg-accent" },
  revised: { pill: "border-good/20 bg-good/10 text-good", dot: "bg-good" },
};

/** A topic's status as a small pill: grey until studied, indigo when studied, green when revised. */
function StatusSelect({ status, name, onChange }: { status: TopicStatus; name: string; onChange: (s: TopicStatus) => void }) {
  const tone = STATUS_TONE[status];
  return (
    <span className="relative inline-flex">
      <span aria-hidden className={cn("pointer-events-none absolute left-2.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full transition-colors duration-200", tone.dot)} />
      <select
        value={status}
        onChange={(e) => onChange(e.target.value as TopicStatus)}
        aria-label={`Status of ${name}`}
        className={cn(
          "select-chevron h-7 rounded-full border pl-6 text-xs font-medium pointer-coarse:h-9 transition-[color,background-color,border-color,box-shadow] duration-200 hover:border-line-strong focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--accent)_18%,transparent)] focus-visible:outline-none",
          tone.pill,
        )}
      >
        <option value="not-started">Not started</option>
        <option value="studied">Studied</option>
        <option value="revised">Revised</option>
      </select>
    </span>
  );
}

// Rename and delete wait in the wings on a mouse, showing on hover or keyboard focus; on touch they're always there.
const rowActions = "flex transition-opacity duration-150 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100";
// On a mouse they float over the title's end, left of the pill, so they hold no space and every pill meets the
// unit's right edge, in line with its header icons and Add button. Not while renaming: they'd cover the Save button.
const rowActionsOverlay = "[@media(hover:hover)]:absolute [@media(hover:hover)]:right-full [@media(hover:hover)]:mr-2 [@media(hover:hover)]:rounded-lg [@media(hover:hover)]:bg-surface-2";

function TopicRow({ topic }: { topic: Topic }) {
  const [editing, setEditing] = useState(false);
  const id = topic.id!;

  const remove = async () => {
    if (confirm(`Delete topic "${topic.title}"?`)) await deleteTopics([id]).catch(() => toast(SAVE_FAILED));
  };

  return (
    <li className="group flex items-center gap-x-3 py-2.5 pl-5 pr-3 transition-colors duration-150 hover:bg-surface-2 sm:gap-x-4">
      {/* The title wraps rather than pushing the pill onto a line of its own on a phone. */}
      <div className="min-w-0 flex-1 break-words">
        {editing ? (
          <InlineRename name={topic.title} label={`New name for ${topic.title}`} onSave={(title) => db.topics.update(id, { title })} onDone={() => setEditing(false)} />
        ) : (
          <span className={cn("text-[15px] leading-snug transition-colors duration-200", topic.status === "revised" && "text-text/75")}>
            {topic.title} {topic.weak && <Badge tone="warn" className="ml-1">Weak</Badge>}
          </span>
        )}
      </div>
      <div className="relative flex shrink-0 items-center gap-2">
        <StatusSelect status={topic.status} name={topic.title} onChange={(status) => db.topics.update(id, { status }).catch(() => toast(SAVE_FAILED))} />
        <span className={cn(rowActions, !editing && rowActionsOverlay)}>
          <Button variant="ghost" size="icon" onClick={() => setEditing(!editing)} aria-label={`Rename ${topic.title}`} title="Rename"><Pencil size={13} /></Button>
          <Button variant="danger" size="icon" onClick={remove} aria-label={`Delete ${topic.title}`} title="Delete"><Trash2 size={13} /></Button>
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
          await db.topics.bulkAdd(named.map((t) => newTopic(subjectId, unitId, t.title.trim())));
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
          Check {draft.length} unit{draft.length === 1 ? "" : "s"} and {count} topic{count === 1 ? "" : "s"} before saving. Fix names and remove anything wrong.
          {mode === "mid-term" && " They'll count towards the mid-sem as well as the major. Remove any unit the mid-sem doesn't cover before you save."}
        </p>
        {draft.map((u, i) => (
          <div key={i}>
            <div className="mb-2 flex gap-2">
              <Input value={u.title} onChange={(e) => editUnit(i, { title: e.target.value })} className="h-9 font-semibold" aria-label={`Unit ${i + 1} name`} />
              <Button variant="danger" size="sm" className="h-9" onClick={() => setDraft(draft.filter((_, j) => j !== i))} aria-label={`Remove unit ${i + 1}`}><Trash2 size={14} /></Button>
            </div>
            <ul className="space-y-1.5 border-l border-border pl-3">
              {u.topics.map((t, k) => (
                <li key={k} className="flex items-center gap-2">
                  <Input
                    value={t.title}
                    onChange={(e) => editUnit(i, { topics: u.topics.map((x, m) => (m === k ? { ...x, title: e.target.value } : x)) })}
                    className="h-8 text-xs"
                    // Positions, not titles: the titles are being edited here.
                    aria-label={`Unit ${i + 1}, topic ${k + 1}`}
                  />
                  <Button variant="ghost" size="sm" onClick={() => editUnit(i, { topics: u.topics.filter((_, m) => m !== k) })} aria-label={`Remove topic ${k + 1} from unit ${i + 1}`}><Trash2 size={13} /></Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <AiErrorBox error={error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDraft(null)}>Back</Button>
          <Button onClick={save} disabled={saving || !count}>Save {count} topic{count === 1 ? "" : "s"}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* sr-only, not hidden: a display:none input can't take focus, so the keyboard could never reach the upload. */}
      <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-line-strong p-4 text-sm text-muted transition-colors duration-150 hover:border-accent/40 hover:bg-surface-2 hover:text-text focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
        <Upload size={18} className="shrink-0" aria-hidden />
        Upload the syllabus as a PDF, photo or text file
        <input
          type="file"
          accept="application/pdf,.txt,.md,image/*"
          className="sr-only"
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
