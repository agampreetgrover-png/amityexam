"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { db, deleteSubject } from "@/lib/db";
import { coverage, SUBJECT_COLORS } from "@/lib/stats";
import type { Subject } from "@/lib/types";
import { Badge, Button, Empty, Field, Input, List, Modal, PageHeader, Progress } from "@/components/ui";

export default function SubjectsPage() {
  const subjects = useLiveQuery(() => db.subjects.orderBy("name").toArray());
  const topics = useLiveQuery(() => db.topics.toArray());
  const [editing, setEditing] = useState<Subject | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageHeader
        title="Subjects"
        sub="Syllabus, notes, flashcards and practice for each subject"
        action={<Button onClick={() => setAdding(true)}><Plus size={16} /> Add subject</Button>}
      />
      {subjects?.length === 0 && (
        <Empty icon={<BookOpen size={28} />} title="No subjects yet">
          Add the subjects for this semester, then import each syllabus with AI.
        </Empty>
      )}
      {!!subjects?.length && (
        <List>
          {subjects.map((s) => {
            const ts = topics?.filter((t) => t.subjectId === s.id) ?? [];
            const cov = coverage(ts);
            const weak = ts.filter((t) => t.weak).length;
            return (
              <li key={s.id} className="relative flex items-center gap-3 py-4">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                <Link href={`/subjects/${s.id}`} className="min-w-0 flex-1 after:absolute after:inset-0">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate font-semibold">{s.name}</span>
                    {weak > 0 && <Badge className="shrink-0 text-warn">{weak} weak</Badge>}
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-muted">
                    {s.code && <span>{s.code}</span>}
                    <span>{ts.length} topics</span>
                    {s.credits ? <span>{s.credits} credits</span> : null}
                  </span>
                  <span className="mt-2.5 flex items-center gap-2">
                    <Progress value={cov} color={s.color} className="max-w-56" />
                    <span className="text-xs tabular-nums text-muted">{cov}%</span>
                  </span>
                </Link>
                <div className="relative z-10 flex shrink-0">
                  <Button variant="ghost" size="sm" aria-label="Edit" onClick={() => setEditing(s)}><Pencil size={15} /></Button>
                  <Button
                    variant="danger"
                    size="sm"
                    aria-label="Delete"
                    onClick={() => confirm(`Delete ${s.name} and all its topics, exams, notes and cards?`) && deleteSubject(s.id!)}
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              </li>
            );
          })}
        </List>
      )}
      <Modal open={adding || !!editing} onClose={() => { setAdding(false); setEditing(null); }} title={editing ? "Edit subject" : "Add subject"}>
        <SubjectForm
          initial={editing}
          used={subjects?.length ?? 0}
          onDone={() => { setAdding(false); setEditing(null); }}
        />
      </Modal>
    </>
  );
}

function SubjectForm({ initial, used, onDone }: { initial: Subject | null; used: number; onDone: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [credits, setCredits] = useState(initial?.credits?.toString() ?? "");
  const [color, setColor] = useState(initial?.color ?? SUBJECT_COLORS[used % SUBJECT_COLORS.length]);
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    // `required` lets a name of only spaces through; the guard also stops a double tap adding it twice.
    if (saving || !name.trim()) return;
    setSaving(true);
    const n = Number(credits);
    const data = { name: name.trim(), code: code.trim() || undefined, credits: credits && Number.isFinite(n) && n >= 0 ? n : undefined, color };
    try {
      if (initial?.id) await db.subjects.update(initial.id, data);
      else await db.subjects.add({ ...data, createdAt: Date.now() });
      onDone();
    } catch {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Name"><Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Database Management Systems" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Course code"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="CSE204" /></Field>
        <Field label="Credits"><Input type="number" min={0} value={credits} onChange={(e) => setCredits(e.target.value)} /></Field>
      </div>
      <Field label="Colour">
        <div className="flex flex-wrap gap-2.5">
          {SUBJECT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className="h-8 w-8 rounded-full"
              style={{ background: c, boxShadow: color === c ? `0 0 0 2px var(--surface), 0 0 0 4px ${c}` : undefined }}
            />
          ))}
        </div>
      </Field>
      <div className="flex justify-end pt-2"><Button type="submit" disabled={saving || !name.trim()}>Save subject</Button></div>
    </form>
  );
}
