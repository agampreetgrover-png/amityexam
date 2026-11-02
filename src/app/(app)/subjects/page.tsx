"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight, BookOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { db, deleteSubject, getSettings } from "@/lib/db";
import { modeShort, topicsInScope } from "@/lib/mode";
import { hotThreshold, papersForMode, questionsOf } from "@/lib/pyq/group";
import { coverage, SUBJECT_COLORS } from "@/lib/stats";
import type { ExamMode, PyqQuestion, Subject, Topic } from "@/lib/types";
import { Badge, Button, CoverageBar, Empty, Field, Input, Menu, Modal, PageHeader, Panel, subjectStyle, type BadgeTone } from "@/components/ui";
import { SubjectPicker, subjectKey } from "@/components/subject-picker";
import { findCode } from "@/lib/drive/catalog";
import { runDriveSync } from "@/lib/drive/client";
import { useCourseCatalog } from "@/lib/drive/use-catalog";

export default function SubjectsPage() {
  const subjects = useLiveQuery(() => db.subjects.orderBy("name").toArray());
  // Everything the rows count, in one query, so they draw once at their real values instead of sweeping up from zero.
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
        <Panel as="ul" className="@container divide-y divide-border">
          {subjects.map((s) => (
              <SubjectRow
                key={s.id}
                subject={s}
                topics={data.topics.filter((t) => t.subjectId === s.id)}
                questions={data.questions.filter((q) => q.subjectId === s.id)}
                mode={data.mode}
                imported={data.imported.has(s.id!)}
                onEdit={() => setEditing(s)}
              />
            ))}
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
 * One subject as a row of the list. The whole row opens the subject: its name is the link, stretched over the row,
 * while the section links and the menu sit above that as targets of their own. The row lays itself out by the list's
 * width rather than the window's: stacked on a phone; name, links and menu over a line of figures on a tablet or a
 * desk beside the sidebar; and one line, every figure in its own column, once the list is wide enough for the name
 * to keep its room.
 */
function SubjectRow({ subject: s, topics: ts, questions, mode, imported, onEdit }: {
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
  // The name's last word, kept with the arrow. A very long one is left free to break, so it can't widen a phone row.
  const name = s.name.trim();
  const cutAt = name.lastIndexOf(" ") + 1;
  const [head, last] = name.length - cutAt <= 16 ? [name.slice(0, cutAt), name.slice(cutAt)] : [name, ""];

  return (
    <li
      style={subjectStyle(s.color)}
      // The wash follows the row's own link (data-row), so pointing at a section link or the menu doesn't light the row.
      className="relative p-4 transition-colors duration-150 ease-snappy has-[a[data-row]:hover]:bg-surface-2/60 has-[a[data-row]:active]:bg-surface-2 sm:p-5 @xl:grid @xl:grid-cols-[minmax(0,1fr)_auto_auto] @xl:items-center @xl:gap-x-5 @5xl:grid-cols-[minmax(0,1.4fr)_6rem_9rem_minmax(0,1fr)_13.5rem_1.75rem] @5xl:gap-x-6"
    >
      <div className="min-w-0 pr-10 @xl:col-start-1 @xl:row-start-1 @xl:pr-0">
        <h2 className="text-[16px] font-semibold leading-snug tracking-[-0.01em]">
          {/* Its ::after covers the row, so a click anywhere on it opens the subject; the focus ring is drawn round the row. */}
          <Link
            href={href}
            data-row
            className="group/link flex items-start gap-2.5 transition-colors duration-150 after:absolute after:inset-0 after:rounded-xl hover:text-[color-mix(in_oklab,var(--subj)_72%,var(--text))] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-4 focus-visible:after:outline-accent"
          >
            <span aria-hidden className="subj-dot mt-[0.45em] size-2 shrink-0 rounded-full transition-transform duration-200 ease-snappy group-hover/link:scale-150" />
            {/* The full name, wrapping rather than cut short. The arrow is held to the last word so it never sits
                alone on a line of its own. */}
            <span className="min-w-0 break-words">
              {head}
              <span className="whitespace-nowrap">
                {last}
                <ArrowRight
                  size={15}
                  aria-hidden
                  className="ml-1.5 inline-block align-[-0.15em] text-faint transition-[color,translate] duration-200 ease-snappy group-hover/link:translate-x-0.5 group-hover/link:text-muted"
                />
              </span>
            </span>
          </Link>
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[18px]">
          {s.code && <Badge>{s.code}</Badge>}
          {s.credits ? <Badge>{s.credits} credit{s.credits === 1 ? "" : "s"}</Badge> : null}
          {/* "In progress" would be on nearly every row, so only the states worth noticing get a badge. */}
          {st.label !== "In progress" && <Badge tone={st.tone}>{st.label}</Badge>}
        </div>
      </div>

      {/* Every figure has a small label over it, so each row reads on its own without column headings. On the
          widest list the figures drop into the row's own columns. */}
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 pl-[18px] @xl:col-span-full @xl:row-start-2 @xl:grid-cols-[6rem_9rem_minmax(0,1fr)] @5xl:contents">
        <div className="min-w-0">
          <dt className="text-xs text-muted">{mode ? `${modeShort(mode)} topics` : "Topics"}</dt>
          <dd className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="text-lg font-semibold leading-6 tabular-nums">{ts.length}</span>
            {weak > 0 && <span className="text-xs font-medium tabular-nums text-mark-ink">{weak} weak</span>}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">Past-paper questions</dt>
          <dd className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="text-lg font-semibold leading-6 tabular-nums">{questions.length}</span>
            {hot > 0 && <span className="text-xs font-medium tabular-nums text-accent">{hot} most asked</span>}
          </dd>
        </div>
        {/* Emerald, as progress is everywhere: revised topics in full, studied ones paler at half their share. */}
        <div className="col-span-2 min-w-0 @xl:col-span-1">
          <dt className="flex justify-between gap-3 text-xs text-muted">
            <span className="tabular-nums">{revised} of {ts.length} revised</span>
            {timed.length > 0 && (
              <span className="tabular-nums" title="AI estimate for the topics still to revise">
                {duration(mins)}{timed.length < left.length ? "+" : ""} left
              </span>
            )}
          </dt>
          <dd className="mt-1 flex h-6 items-center gap-3" style={subjectStyle("var(--mastery)")}>
            <CoverageBar topics={ts} className="flex-1" />
            <span className="w-9 text-right text-[13px] font-semibold tabular-nums">{cov}%<span className="sr-only"> of the syllabus covered</span></span>
          </dd>
        </div>
      </dl>

      {/* Above the row's link (z-10), so each goes to its own tab. A solid fill keeps them reading as controls on the hover wash. */}
      <nav
        aria-label={`${s.name} sections`}
        className="relative z-10 mt-4 grid grid-cols-3 divide-x divide-border overflow-hidden rounded-lg border border-border bg-surface @xl:col-start-2 @xl:row-start-1 @xl:mt-0 @xl:w-[13.5rem] @5xl:col-start-5"
      >
        {QUICK_LINKS.map((l) => (
          <Link
            key={l.tab}
            href={`${href}&tab=${l.tab}`}
            className="flex h-9 items-center justify-center text-[13px] font-medium text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-text focus-visible:-outline-offset-2 active:bg-surface-3 pointer-coarse:h-10"
          >
            {l.label}
          </Link>
        ))}
      </nav>

      <Menu
        label={`Actions for ${s.name}`}
        className="absolute right-3 top-3.5 z-10 sm:right-4 sm:top-4.5 @xl:relative @xl:right-auto @xl:top-auto @xl:col-start-3 @xl:row-start-1 @5xl:col-start-6"
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
