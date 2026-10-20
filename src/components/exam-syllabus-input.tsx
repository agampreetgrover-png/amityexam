"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { db } from "@/lib/db";
import { parseTopics } from "@/lib/syllabus-text";
import type { ExamMode, Topic } from "@/lib/types";
import { Button, Input, Textarea } from "./ui";

const newTopic = (subjectId: number, unitId: number, title: string): Topic => ({
  subjectId, unitId, title, difficulty: 3, confidence: 3, status: "not-started", ease: 2.5, interval: 0, reps: 0,
});

/**
 * Lets the student type or paste an exam's syllabus right in the exam form.
 * The topics go into the subject's syllabus for the exam's season, so the planner and the subject page see them too.
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
  const [unit, setUnit] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
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
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline hover:underline-offset-2"
      >
        <Plus size={15} /> Type or paste topics
      </button>
    );
  }

  return (
    // A div, not a nested <form>: this sits inside the exam form, and Enter in the unit name must not save the exam.
    <div className="space-y-2.5 rounded-lg bg-surface-2/70 p-3">
      <Input
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
        placeholder="Unit name (optional), e.g. Unit 1: Relational model"
        aria-label="Unit name"
        className="h-9 bg-surface"
      />
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"One topic per line, e.g.\nER model\nNormalization\nSQL joins"}
        aria-label="Topics, one per line"
        className="min-h-28 bg-surface"
      />
      {error && <p className="text-xs text-bad" role="alert">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">
          {titles.length
            ? `${titles.length} topic${titles.length === 1 ? "" : "s"}, added to the subject's syllabus${season === "mid-term" ? " as mid-sem" : ""}`
            : `Added to the subject's syllabus too${season === "mid-term" ? ", marked as mid-sem" : ""}`}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => { setOpen(false); setError(""); }}>Cancel</Button>
          <Button type="button" size="sm" onClick={add} disabled={!titles.length || saving}>
            {saving ? "Adding…" : titles.length ? `Add ${titles.length} topic${titles.length === 1 ? "" : "s"}` : "Add topics"}
          </Button>
        </div>
      </div>
    </div>
  );
}
