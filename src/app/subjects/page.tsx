"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { db, deleteSubject } from "@/lib/db";
import { coverage, SUBJECT_COLORS } from "@/lib/stats";
import type { Subject } from "@/lib/types";
import { Badge, Button, Empty, Field, Input, Modal, PageHeader, Progress, cn } from "@/components/ui";
import { SubjectPicker } from "@/components/subject-picker";
import { findCode } from "@/lib/drive/catalog";
import { runDriveSync } from "@/lib/drive/client";
import { useCourseCatalog } from "@/lib/drive/use-catalog";

export default function SubjectsPage() {
  const subjects = useLiveQuery(() => db.subjects.orderBy("name").toArray());
  const topics = useLiveQuery(() => db.topics.toArray());
  const [editing, setEditing] = useState<Subject | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <>
      <PageHeader
        title="Subjects"
        sub="Syllabus, notes and practice for each subject"
        action={<Button onClick={() => setAdding(true)}><Plus size={16} /> Add subject</Button>}
      />
      {subjects?.length === 0 && (
        <Empty icon={<BookOpen size={28} />} title="No subjects yet">
          Add the subjects for this semester, then import each syllabus with AI.
        </Empty>
      )}
      {!!subjects?.length && (
        <ul className="grid gap-4 sm:grid-cols-2">
          {subjects.map((s) => {
            const ts = topics?.filter((t) => t.subjectId === s.id) ?? [];
            const cov = coverage(ts);
            const weak = ts.filter((t) => t.weak).length;
            return (
              <li
                key={s.id}
                className="relative overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-[0_1px_3px_rgb(17_24_39/0.04)] transition-shadow hover:shadow-[0_4px_14px_rgb(17_24_39/0.07)]"
              >
                <span className="absolute inset-x-0 top-0 h-1" style={{ background: s.color }} aria-hidden />
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${s.color}1f`, color: s.color }}>
                    <BookOpen size={19} />
                  </span>
                  <Link href={`/subjects/view?id=${s.id}`} className="min-w-0 flex-1 after:absolute after:inset-0">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-[15px] font-semibold">{s.name}</span>
                      {weak > 0 && <Badge className="shrink-0 bg-mark-soft text-warn">{weak} weak</Badge>}
                    </span>
                    <span className="mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-muted">
                      {s.code && <span>{s.code}</span>}
                      <span>{ts.length} topics</span>
                      {s.credits ? <span>{s.credits} credits</span> : null}
                    </span>
                  </Link>
                  <div className="relative z-10 -mr-2 -mt-1 flex shrink-0">
                    <Button variant="ghost" size="sm" aria-label="Edit" onClick={() => setEditing(s)}><Pencil size={15} /></Button>
                    <Button
                      variant="danger"
                      size="sm"
                      aria-label="Delete"
                      onClick={() => confirm(`Delete ${s.name} and all its topics, exams, notes and quizzes?`) && deleteSubject(s.id!)}
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </div>
                <div className="mt-5">
                  <div className="mb-1.5 flex justify-between gap-3 text-[13px]">
                    <span className="text-muted">Syllabus covered</span>
                    <span className={cn("font-semibold tabular-nums", cov < 50 ? "text-warn" : "text-good")}>{cov}%</span>
                  </div>
                  <Progress value={cov} color={s.color} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Modal open={adding || !!editing} onClose={() => { setAdding(false); setEditing(null); }} title={editing ? "Edit subject" : "Add subject"}>
        <SubjectForm
          initial={editing}
          used={subjects?.length ?? 0}
          taken={subjects?.filter((s) => s.id !== editing?.id).map((s) => s.name) ?? []}
          onDone={() => { setAdding(false); setEditing(null); }}
        />
      </Modal>
    </>
  );
}

function SubjectForm({ initial, used, taken, onDone }: { initial: Subject | null; used: number; taken: string[]; onDone: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  // Until the student edits the code themselves, it follows the name via the Drive course list.
  const [codeTouched, setCodeTouched] = useState(!!initial?.code);
  const catalog = useCourseCatalog();
  const suggested = codeTouched ? undefined : findCode(name, catalog);
  const shownCode = codeTouched ? code : (suggested ?? "");
  const [credits, setCredits] = useState(initial?.credits?.toString() ?? "");
  const [color, setColor] = useState(initial?.color ?? SUBJECT_COLORS[used % SUBJECT_COLORS.length]);
  const [saving, setSaving] = useState(false);
  // The picker hides subjects already added, but a typed name can still repeat one.
  const duplicate = taken.some((t) => t.trim().toLowerCase() === name.trim().toLowerCase());

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    // `required` lets a name of only spaces through; the guard also stops a double tap adding it twice.
    if (saving || !name.trim() || duplicate) return;
    setSaving(true);
    const n = Number(credits);
    let code = shownCode.trim();
    // Saved before the course list arrived (it's slow on a cold start): look the code up now instead of saving none.
    if (!code && !codeTouched && !catalog.length) {
      const list = await fetch("/api/drive/catalog", { signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
      code = findCode(name, list) ?? "";
    }
    const data = { name: name.trim(), code: code || undefined, credits: credits && Number.isFinite(n) && n >= 0 ? n : undefined, color };
    try {
      if (initial?.id) await db.subjects.update(initial.id, data);
      else await db.subjects.add({ ...data, createdAt: Date.now() });
      onDone();
      // Fetch this subject's notes and past papers right away instead of on the next app open.
      if (!initial || initial.name !== data.name || initial.code !== data.code) runDriveSync().catch(() => {});
    } catch {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Name"><SubjectPicker value={name} onChange={setName} exclude={taken} courses={catalog} autoFocus /></Field>
      {duplicate && <p className="-mt-2 text-sm text-bad" role="alert">You already have a subject called that.</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Course code" hint={suggested ? "Filled in from the Amity course list" : undefined}>
          <Input value={shownCode} onChange={(e) => { setCodeTouched(true); setCode(e.target.value); }} placeholder="CSE204" />
        </Field>
        <Field label="Credits"><Input type="number" min={0} value={credits} onChange={(e) => setCredits(e.target.value)} /></Field>
      </div>
      {/* Not <Field>: that's a <label>, and a label around these buttons made tapping "Colour" pick the first one. */}
      <div className="space-y-1.5">
        <span id="subject-colour" className="block text-[13px] font-medium text-muted">Colour</span>
        <div role="radiogroup" aria-labelledby="subject-colour" className="flex flex-wrap gap-2.5">
          {SUBJECT_COLORS.map((c, i) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-label={`Colour ${i + 1}`}
              aria-checked={color === c}
              onClick={() => setColor(c)}
              className="h-8 w-8 rounded-full"
              style={{ background: c, boxShadow: color === c ? `0 0 0 2px var(--surface), 0 0 0 4px ${c}` : undefined }}
            />
          ))}
        </div>
      </div>
      <div className="flex justify-end pt-2"><Button type="submit" disabled={saving || !name.trim() || duplicate}>Save subject</Button></div>
    </form>
  );
}
