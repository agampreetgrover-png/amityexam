"use client";

import { Plus } from "lucide-react";
import { useId, useState } from "react";
import { db } from "@/lib/db";
import { newTopic, parseTopics } from "@/lib/syllabus-text";
import type { ExamMode } from "@/lib/types";
import { AiErrorBox } from "./ai-error";
import { Button, Input, Textarea, cn } from "./ui";

/**
 * Lets the student type or paste an exam's syllabus right in the exam form.
 * The topics go into the subject's syllabus for the exam's season, so the subject page sees them too.
 */
export function ExamSyllabusInput({ subjectId, season, defaultOpen, onAdded }: {
  subjectId: number;
  /** Which syllabus the new unit belongs to: the exam's season. */
  season: ExamMode;
  /** Open straight away when the subject has no syllabus for this season yet. */
  defaultOpen?: boolean;
  /** Receives the new topic ids so the form can tick them for this exam. */
  onAdded: (topicIds: number[]) => void;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  // Opened or closed by the student (not open from the start): focus moves into the fields, or back to the button.
  const [moved, setMoved] = useState(false);
  const [unit, setUnit] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const topicsId = useId(); // Enter in the unit name moves here
  const titles = parseTopics(text);

  const add = async () => {
    if (!titles.length || saving) return;
    setSaving(true);
    setError("");
    try {
      const ids = await db.transaction("rw", db.units, db.topics, async () => {
        const existing = await db.units.where({ subjectId }).toArray();
        const order = existing.reduce((m, u) => Math.max(m, u.order + 1), 0);
        // One syllabus per subject, so a new unit is numbered after all of its units.
        const unitId = (await db.units.add({
          subjectId,
          title: unit.trim() || `Unit ${existing.length + 1}`,
          order,
          exam: season,
        })) as number;
        return (await db.topics.bulkAdd(titles.map((t) => newTopic(subjectId, unitId, t)), { allKeys: true })) as number[];
      });
      onAdded(ids);
      setUnit("");
      setText("");
      setMoved(true);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? `Could not save the topics: ${e.message}` : "Could not save the topics.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        autoFocus={moved}
        onClick={() => {
          setMoved(true);
          setOpen(true);
        }}
        className="press -mx-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-accent hover:bg-accent-soft hover:text-accent-hover"
      >
        <Plus size={15} aria-hidden /> Type or paste topics
      </button>
    );
  }

  return (
    // A div, not a nested <form>: this sits inside the exam form, and Enter in the unit name must not save the exam.
    // Settles in when the student opens it; already open on arrival, it just sits there.
    <div className={cn("space-y-2.5 rounded-xl border border-border bg-surface-2 p-3", moved && "tab-in")}>
      <Input
        autoFocus={moved}
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
        // Enter moves on to the topics instead of saving the exam.
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          document.getElementById(topicsId)?.focus();
        }}
        placeholder="Unit name (optional), e.g. Unit 1: Relational model"
        aria-label="Unit name"
        className="h-9 bg-surface"
      />
      <Textarea
        id={topicsId}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"One topic per line, e.g.\nER model\nNormalization\nSQL joins"}
        aria-label="Topics, one per line"
        className="min-h-28 bg-surface"
      />
      <AiErrorBox error={error} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs tabular-nums text-muted">
          {titles.length
            ? `${titles.length} topic${titles.length === 1 ? "" : "s"}, added to the subject's syllabus${season === "mid-term" ? " as mid-sem" : ""}`
            : `Added to the subject's syllabus too${season === "mid-term" ? ", marked as mid-sem" : ""}`}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => { setMoved(true); setOpen(false); setError(""); }}>Cancel</Button>
          <Button type="button" size="sm" onClick={add} disabled={!titles.length || saving}>
            {saving ? "Adding…" : titles.length ? `Add ${titles.length} topic${titles.length === 1 ? "" : "s"}` : "Add topics"}
          </Button>
        </div>
      </div>
    </div>
  );
}
