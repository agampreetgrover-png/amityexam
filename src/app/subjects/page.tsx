"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { db, deleteSubject } from "@/lib/db";
import { coverage, SUBJECT_COLORS } from "@/lib/stats";
import type { Subject, Topic } from "@/lib/types";
import { Badge, Button, CoverageBar, Empty, Field, Input, Modal, PageHeader, Panel, cn, subjectStyle, tableHead } from "@/components/ui";
import { SubjectPicker, subjectKey } from "@/components/subject-picker";
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
      {/* Drawn once topics are in too, so the coverage bars don't sweep up from zero on every visit. */}
      {!!subjects?.length && topics && (
        <Panel>
          {/* Column headings line up with the row layout below; on phones each row labels its own coverage. */}
          <div aria-hidden className={cn(tableHead, "hidden gap-6 py-2.5 pl-6 pr-4 sm:grid", COLS)}>
            <span>Subject</span>
            <span>Syllabus covered</span>
            <span />
          </div>
          <ul className="divide-y divide-border">
            {subjects.map((s) => (
              <SubjectRow key={s.id} subject={s} topics={topics.filter((t) => t.subjectId === s.id)} onEdit={() => setEditing(s)} />
            ))}
          </ul>
        </Panel>
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

// Subject, coverage, actions. Shared by the heading row and every subject row so they line up.
const COLS = "sm:grid-cols-[minmax(0,1fr)_13.5rem_6.5rem]";

/** One subject in the table. The whole row opens the subject; edit and delete sit above the link. */
function SubjectRow({ subject: s, topics: ts, onEdit }: { subject: Subject; topics: Topic[]; onEdit: () => void }) {
  const cov = coverage(ts);
  const weak = ts.filter((t) => t.weak).length;
  return (
    <li
      style={subjectStyle(s.color)}
      className={cn("subj-tab subj-hover group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 py-4 pl-6 pr-4 sm:gap-x-6", COLS)}
    >
      <Link href={`/subjects/view?id=${s.id}`} className="min-w-0 rounded-md after:absolute after:inset-0">
        <span className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold tracking-[-0.01em] transition-colors duration-150 group-hover:text-[color-mix(in_oklab,var(--subj)_72%,var(--text))]">
            {s.name}
          </span>
          {weak > 0 && <Badge className="shrink-0 bg-bad/10 text-bad">{weak} weak</Badge>}
        </span>
        <span className="mt-1 flex flex-wrap gap-x-3 text-[13px] text-muted">
          {s.code && <span className="font-medium text-text/70">{s.code}</span>}
          <span>{ts.length} topic{ts.length === 1 ? "" : "s"}</span>
          {s.credits ? <span>{s.credits} credits</span> : null}
        </span>
      </Link>
      {/* Phones: coverage drops under the name, across the row. Wider: it gets its own column. */}
      <div className="col-span-2 row-start-2 flex items-center gap-3 sm:col-span-1 sm:row-start-auto">
        <span className="w-10 shrink-0 text-sm font-semibold tabular-nums">{cov}%</span>
        <CoverageBar topics={ts} className="flex-1" />
        <span className="text-[13px] text-muted sm:hidden">covered</span>
      </div>
      <div className="relative z-10 -my-1 flex shrink-0 items-center justify-end gap-0.5">
        <Button variant="ghost" size="icon" aria-label={`Edit ${s.name}`} title="Edit" onClick={onEdit}><Pencil size={15} /></Button>
        <Button
          variant="danger"
          size="icon"
          aria-label={`Delete ${s.name}`}
          title="Delete"
          onClick={() => confirm(`Delete ${s.name} and all its topics, exams, notes and quizzes?`) && deleteSubject(s.id!)}
        >
          <Trash2 size={15} />
        </Button>
        <ChevronRight size={16} aria-hidden className="ml-1 hidden text-faint transition-transform duration-200 ease-snappy group-hover:translate-x-0.5 group-hover:text-muted sm:block" />
      </div>
    </li>
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
  const duplicate = !!name.trim() && taken.some((t) => subjectKey(t) === subjectKey(name));

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
              className="h-7 w-7 rounded-full transition-shadow duration-150"
              // The chosen swatch gets a ring in its own colour, set off by a white gap.
              style={{
                background: c,
                boxShadow: color === c ? `0 0 0 2px var(--surface), 0 0 0 4px ${c}` : undefined,
              }}
            />
          ))}
        </div>
      </div>
      <div className="flex justify-end pt-2"><Button type="submit" disabled={saving || !name.trim() || duplicate}>Save subject</Button></div>
    </form>
  );
}
