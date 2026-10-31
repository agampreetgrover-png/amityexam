"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { db, deleteSubject, getSettings } from "@/lib/db";
import { modeShort, topicsInScope } from "@/lib/mode";
import { hotThreshold, papersForMode, questionsOf } from "@/lib/pyq/group";
import { coverage, SUBJECT_COLORS } from "@/lib/stats";
import type { ExamMode, PyqQuestion, Subject, Topic } from "@/lib/types";
import { Badge, Button, CoverageBar, Empty, Field, Input, Menu, Modal, PageHeader, subjectStyle, type BadgeTone } from "@/components/ui";
import { SubjectPicker, subjectKey } from "@/components/subject-picker";
import { findCode } from "@/lib/drive/catalog";
import { runDriveSync } from "@/lib/drive/client";
import { useCourseCatalog } from "@/lib/drive/use-catalog";

export default function SubjectsPage() {
  const subjects = useLiveQuery(() => db.subjects.orderBy("name").toArray());
  // Everything the cards count, in one query, so they draw once at their real values instead of sweeping up from zero.
  const data = useLiveQuery(async () => {
    const [units, topics, papers, questions, settings] = await Promise.all([
      db.units.toArray(),
      db.topics.toArray(),
      db.materials.where({ kind: "pyq" }).toArray(),
      db.pyqQuestions.toArray(),
      getSettings(),
    ]);
    const mode = settings.examMode;
    // Only this exam's questions, found by their paper as the PYQs tab does. Papers keep just what that needs, not their text.
    const scoped = mode ? questionsOf(questions, papersForMode(papers.map(({ id, fileName, pyqExam }) => ({ id, fileName, pyqExam })), mode)) : [];
    // Subjects with any syllabus at all, so one with no mid-sem units isn't called empty.
    return { topics: topicsInScope(topics, units, mode), questions: scoped, mode, imported: new Set(topics.map((t) => t.subjectId)) };
  });
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
      {!!subjects?.length && data && (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {subjects.map((s) => (
            <SubjectCard
              key={s.id}
              subject={s}
              topics={data.topics.filter((t) => t.subjectId === s.id)}
              questions={data.questions.filter((q) => q.subjectId === s.id)}
              mode={data.mode}
              imported={data.imported.has(s.id!)}
              onEdit={() => setEditing(s)}
            />
          ))}
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

/** Where a subject's syllabus stands, from its topics in this exam's scope. */
function status(ts: Topic[], cov: number, imported: boolean, mode?: ExamMode): { label: string; tone: BadgeTone } {
  if (!ts.length) return { label: imported && mode ? `No ${modeShort(mode).toLowerCase()} topics` : "No syllabus yet", tone: "neutral" };
  if (ts.every((t) => t.status === "revised")) return { label: "Revised", tone: "good" };
  return cov === 0 ? { label: "Not started", tone: "neutral" } : { label: "In progress", tone: "accent" };
}

/** "3h 20m", "45m". */
const duration = (mins: number) => (mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ""}` : `${mins}m`);

const QUICK_LINKS = [
  { tab: "syllabus", label: "Syllabus" },
  { tab: "pyqs", label: "PYQs" },
  { tab: "quiz", label: "Practice" },
];

/**
 * One subject as a card. Only the title links to the subject, since the card also holds a menu; the footer
 * jumps straight to its syllabus, past papers or a quiz.
 */
function SubjectCard({ subject: s, topics: ts, questions, mode, imported, onEdit }: {
  subject: Subject;
  topics: Topic[];
  questions: PyqQuestion[];
  mode?: ExamMode;
  imported: boolean;
  onEdit: () => void;
}) {
  const cov = coverage(ts);
  const st = status(ts, cov, imported, mode);
  const weak = ts.filter((t) => t.weak).length;
  const revised = ts.filter((t) => t.status === "revised").length;
  // Most asked: topics in the top quarter by questions asked, the same cut the PYQs tab marks as frequently asked.
  const ids = new Set(ts.map((t) => t.id));
  const asked = new Map<number, number>();
  for (const q of questions) if (typeof q.topicId === "number" && ids.has(q.topicId)) asked.set(q.topicId, (asked.get(q.topicId) ?? 0) + 1);
  const cut = hotThreshold([...asked.values()]);
  const hot = [...asked.values()].filter((n) => n >= cut).length;
  // Time left only from topics the AI has timed (Zero prep); "+" when some topics still to revise have no estimate.
  const left = ts.filter((t) => t.status !== "revised");
  const timed = left.filter((t) => t.prep);
  const mins = timed.reduce((a, t) => a + t.prep!.mins, 0);
  const href = `/subjects/view?id=${s.id}`;

  return (
    <li
      style={subjectStyle(s.color)}
      className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-sheet transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-lift"
    >
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {s.code && <Badge>{s.code}</Badge>}
            {s.credits ? <Badge>{s.credits} credit{s.credits === 1 ? "" : "s"}</Badge> : null}
            {/* "In progress" would be on nearly every card, so only the states worth noticing get a badge. */}
            {st.label !== "In progress" && <Badge tone={st.tone}>{st.label}</Badge>}
          </div>
          <Menu
            label={`Actions for ${s.name}`}
            className="-mr-1.5 -mt-0.5"
            items={[
              { label: "Edit", icon: <Pencil size={15} />, onSelect: onEdit },
              {
                label: "Delete",
                icon: <Trash2 size={15} />,
                danger: true,
                onSelect: () => confirm(`Delete ${s.name} and all its topics, exams, notes and quizzes?`) && deleteSubject(s.id!),
              },
            ]}
          />
        </div>

        <h2 className="mt-4 text-[16px] font-semibold leading-snug tracking-[-0.01em]">
          <Link href={href} className="inline-flex max-w-full items-start gap-2.5 rounded-md transition-colors duration-150 hover:text-[color-mix(in_oklab,var(--subj)_72%,var(--text))]">
            <span aria-hidden className="subj-dot mt-[0.45em] size-2 shrink-0 rounded-full" />
            <span className="line-clamp-2 break-words">{s.name}</span>
          </Link>
        </h2>

        <dl className="mt-4 grid grid-cols-2 gap-2">
          <div className="min-w-0 rounded-lg bg-surface-2 px-3 py-2.5">
            <dt className="text-xs text-muted">{mode ? `${modeShort(mode)} topics` : "Topics"}</dt>
            <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
              <span className="text-lg font-semibold tabular-nums">{ts.length}</span>
              {weak > 0 && <span className="text-xs font-medium tabular-nums text-mark-ink">{weak} weak</span>}
            </dd>
          </div>
          <div className="min-w-0 rounded-lg bg-surface-2 px-3 py-2.5">
            <dt className="text-xs text-muted">Past-paper questions</dt>
            <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
              <span className="text-lg font-semibold tabular-nums">{questions.length}</span>
              {hot > 0 && <span className="text-xs font-medium tabular-nums text-accent">{hot} most asked</span>}
            </dd>
          </div>
        </dl>

        {/* Pushed to the card's foot, so the bars line up across a row whatever the title's length. Emerald, as
            progress is everywhere: revised topics in full, studied ones paler at half their share. */}
        <div className="mt-auto pt-5">
          <div className="flex items-center gap-3" style={subjectStyle("var(--mastery)")}>
            <CoverageBar topics={ts} className="flex-1" />
            <span className="text-sm font-semibold tabular-nums">{cov}%<span className="sr-only"> of the syllabus covered</span></span>
          </div>
          <p className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-[13px] text-muted">
            <span className="tabular-nums">{revised} of {ts.length} revised</span>
            {timed.length > 0 && (
              <span className="tabular-nums" title="AI estimate for the topics still to revise">
                {duration(mins)}{timed.length < left.length ? "+" : ""} left
              </span>
            )}
          </p>
        </div>
      </div>

      <nav aria-label={`${s.name} sections`} className="grid grid-cols-3 divide-x divide-border border-t border-border">
        {QUICK_LINKS.map((l) => (
          <Link
            key={l.tab}
            href={`${href}&tab=${l.tab}`}
            className="group flex min-w-0 items-center justify-between gap-1 px-4 py-2.5 text-[13px] font-medium text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-text focus-visible:-outline-offset-2"
          >
            {l.label}
            <ChevronRight size={14} aria-hidden className="text-faint transition-colors duration-150 group-hover:text-muted" />
          </Link>
        ))}
      </nav>
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
  const [saveError, setSaveError] = useState(false);
  // The picker hides subjects already added, but a typed name can still repeat one.
  const duplicate = !!name.trim() && taken.some((t) => subjectKey(t) === subjectKey(name));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    // `required` lets a name of only spaces through; the guard also stops a double tap adding it twice.
    if (saving || !name.trim() || duplicate) return;
    setSaving(true);
    setSaveError(false);
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
      setSaveError(true);
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
        <span id="subject-colour" className="block text-[13px] font-medium text-text/85">Colour</span>
        <div role="radiogroup" aria-labelledby="subject-colour" className="flex flex-wrap gap-2.5">
          {SUBJECT_COLORS.map((c, i) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-label={`Colour ${i + 1}`}
              aria-checked={color === c}
              onClick={() => setColor(c)}
              className="subj-dot h-7 w-7 rounded-full transition-shadow duration-150 pointer-coarse:h-9 pointer-coarse:w-9"
              // The chosen swatch gets a ring in its own colour, set off by a white gap. Both soften on the dark board like every subject dot.
              style={{
                ...subjectStyle(c),
                boxShadow: color === c ? "0 0 0 2px var(--surface), 0 0 0 4px light-dark(var(--subj), color-mix(in oklab, var(--subj) 75%, var(--text)))" : undefined,
              }}
            />
          ))}
        </div>
      </div>
      {saveError && <p className="text-sm text-bad" role="alert">Couldn&apos;t save the subject. Try again.</p>}
      <div className="flex justify-end pt-2"><Button type="submit" disabled={saving || !name.trim() || duplicate}>Save subject</Button></div>
    </form>
  );
}
