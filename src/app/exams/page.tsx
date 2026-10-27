"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Briefcase, Check, FileSpreadsheet, GraduationCap, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { db, deleteExam } from "@/lib/db";
import { daysBetween, prettyDay } from "@/lib/dates";
import { useToday } from "@/lib/use-today";
import { DEFAULT_CHECKLIST, EXAM_TYPES, examTypeLabel } from "@/lib/exams";
import { examInMode, examTypeMode, modeShort, unitInScope, useExamMode } from "@/lib/mode";
import type { Exam, ExamMode, ExamType } from "@/lib/types";
import { Button, Empty, Field, Input, Modal, PageHeader, Panel, Section, Select, cn, subjectStyle, tableHead } from "@/components/ui";
import { DatesheetImport } from "@/components/exams/datesheet-import";
import { toast } from "@/components/toast";
import { ExamSyllabusInput } from "@/components/exam-syllabus-input";

// Days, subject, date and time, venue, actions. Shared by the header row and every exam row so they line up.
const COLS = "@xl:grid-cols-[4rem_minmax(0,1.35fr)_minmax(0,0.85fr)_minmax(0,1fr)_10.75rem]";

export default function ExamsPage() {
  const exams = useLiveQuery(() => db.exams.orderBy("date").toArray());
  const subjects = useLiveQuery(() => db.subjects.toArray());
  const [editing, setEditing] = useState<Exam | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const mode = useExamMode();
  const t = useToday();
  const subject = (id: number) => subjects?.find((s) => s.id === id);
  // Only this mode's exams unless "Show all" is ticked.
  const inMode = exams?.filter((e) => examInMode(e, mode)) ?? [];
  const hidden = (exams?.length ?? 0) - inMode.length;
  const shown = showAll ? (exams ?? []) : inMode;
  const upcoming = shown.filter((e) => e.date >= t);
  const past = shown.filter((e) => e.date < t).reverse();

  // One line of the date sheet: the countdown, then what, when and where, then the actions.
  // The columns follow the table's own width (a container query), so with the sidebar open on a
  // narrow window the rows stack instead of squeezing five columns into the space.
  const row = (e: Exam, past = false) => {
    const s = subject(e.subjectId);
    const days = daysBetween(t, e.date);
    const soon = days >= 0 && days <= 3;
    const where = [e.venue, e.seat && `Seat ${e.seat}`].filter(Boolean).join(", ");
    return (
      <li
        key={e.id}
        style={past ? undefined : subjectStyle(s?.color)}
        className={cn(
          "grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-4 gap-y-3 py-4 pl-6 pr-4 @xl:items-center @xl:gap-x-5",
          COLS,
          past ? "text-muted" : cn("subj-tab", soon ? "bg-mark-soft/60" : "subj-hover"),
        )}
      >
        <div className="row-span-2 @xl:row-span-1">
          {days >= 0 ? (
            <div className="numeral subj-ink text-[34px]">
              <span className={soon ? "mark" : undefined}>{days}</span>
            </div>
          ) : (
            <span className="grid h-8 w-8 place-items-center rounded-full bg-good/10 text-good"><Check size={17} strokeWidth={2.2} aria-hidden /></span>
          )}
          <div className="mt-1.5 text-[12px] font-medium text-muted">{days === 0 ? "today" : days > 0 ? (days === 1 ? "day left" : "days left") : "done"}</div>
        </div>
        {/* Stacked under the subject on narrow tables; its own three columns on wide ones. */}
        <div className="min-w-0 space-y-1.5 @xl:contents @xl:space-y-0">
          <div className="min-w-0">
            <h2 className={cn("truncate text-[15px] font-semibold tracking-[-0.01em]", past && "font-medium")}>{s?.name ?? "Unknown subject"}</h2>
            <p className="mt-1 text-[13px] text-muted">
              {examTypeLabel(e.type)}
              {e.topicIds.length > 0 && `, ${e.topicIds.length} topic${e.topicIds.length === 1 ? "" : "s"} in scope`}
            </p>
          </div>
          <p className="text-sm tabular-nums @xl:leading-tight">
            <span className={cn("font-medium", !past && "text-text")}>{prettyDay(e.date)}</span>
            {e.time && <span className="text-muted"><span className="@xl:hidden">, </span><span className="@xl:mt-1 @xl:block @xl:text-[13px]">{e.time}</span></span>}
          </p>
          <p className={cn("min-w-0 text-sm text-muted", !where && "hidden @xl:block")}>
            {where ? (
              <span className="flex items-center gap-1.5">
                <MapPin size={13} className="shrink-0 text-faint" aria-hidden /> <span className="truncate">{where}</span>
              </span>
            ) : (
              <span aria-hidden className="text-faint">–</span>
            )}
          </p>
        </div>
        <div className="col-start-2 flex items-center gap-0.5 @xl:col-start-auto @xl:justify-end">
          <Link
            href={`/exams/view?id=${e.id}`}
            className="press mr-1.5 inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-surface px-2.5 text-[13px] font-medium text-text shadow-control hover:border-line-strong hover:bg-surface-2"
          >
            <Briefcase size={14} className="text-muted" /> Exam kit
          </Link>
          <Button variant="ghost" size="icon" aria-label="Edit exam" title="Edit" onClick={() => setEditing(e)}><Pencil size={15} /></Button>
          <Button variant="danger" size="icon" aria-label="Delete exam" title="Delete" onClick={() => confirm("Delete this exam?") && deleteExam(e.id!)}><Trash2 size={15} /></Button>
        </div>
      </li>
    );
  };

  // One sheet per list; the header row only appears once there's room for the columns.
  const table = (list: Exam[], past = false) => (
    <Panel className="@container">
      <div aria-hidden className={cn(tableHead, "hidden gap-x-5 py-2.5 pl-6 pr-4 @xl:grid", COLS)}>
        <span>Days</span>
        <span>Subject</span>
        <span>Date and time</span>
        <span>Venue</span>
        <span />
      </div>
      <ul className="divide-y divide-border">{list.map((e) => row(e, past))}</ul>
    </Panel>
  );

  return (
    <>
      <PageHeader
        title="Exams"
        sub="Your date sheet and exam-day kits"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setImporting(true)}><FileSpreadsheet size={16} /> Upload date sheet</Button>
            <Button onClick={() => setAdding(true)} disabled={!subjects?.length}><Plus size={16} /> Add exam</Button>
          </div>
        }
      />
      {subjects?.length === 0 && (
        <Empty icon={<GraduationCap size={20} />} title="Add a subject first">
          Every exam belongs to a subject. <Link className="font-medium text-accent underline underline-offset-2" href="/subjects">Add your subjects</Link>
        </Empty>
      )}
      {mode && (hidden > 0 || showAll) && (
        <div className="-mt-4 mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-muted md:-mt-6">
          <span>
            {showAll ? "Showing every exam" : `Showing ${modeShort(mode).toLowerCase()} exams, ${hidden} other${hidden === 1 ? "" : "s"} hidden`}
          </span>
          <label className="flex cursor-pointer select-none items-center gap-2 -mx-2 rounded-lg px-2 py-1 transition-colors duration-150 hover:bg-surface-2 hover:text-text">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show all exams
          </label>
        </div>
      )}
      {subjects?.length !== 0 && exams?.length === 0 && (
        <Empty icon={<GraduationCap size={20} />} title="No exams yet">Add your date sheet to start the countdown.</Empty>
      )}
      {mode && !!exams?.length && !shown.length && (
        <Empty icon={<GraduationCap size={20} />} title={`No ${modeShort(mode).toLowerCase()} exams yet`}>
          Add your {modeShort(mode).toLowerCase()} date sheet to start the countdown.
        </Empty>
      )}
      {upcoming.length > 0 && table(upcoming)}
      {past.length > 0 && (
        <Section title="Past exams" className="mt-10">
          {table(past, true)}
        </Section>
      )}
      <Modal open={adding || !!editing} onClose={() => { setAdding(false); setEditing(null); }} title={editing ? "Edit exam" : "Add exam"}>
        <ExamForm
          initial={editing}
          mode={mode}
          onDone={(saved) => {
            setAdding(false);
            setEditing(null);
            // An exam of the other season disappears from this list, so say where it went.
            const season = saved && examTypeMode(saved);
            if (mode && season && !showAll && !examInMode({ type: saved }, mode)) {
              toast(`Saved. It's a ${modeShort(season).toLowerCase()} exam, so it's hidden in ${modeShort(mode).toLowerCase()} mode`, {
                label: "Show",
                onClick: () => setShowAll(true),
              });
            }
          }}
        />
      </Modal>
      <Modal open={importing} onClose={() => setImporting(false)} title="Upload date sheet">
        <DatesheetImport onDone={() => setImporting(false)} />
      </Modal>
    </>
  );
}

function ExamForm({ initial, mode, onDone }: { initial: Exam | null; mode?: ExamMode; onDone: (savedType?: ExamType) => void }) {
  const subjects = useLiveQuery(() => db.subjects.orderBy("name").toArray());
  const [subjectId, setSubjectId] = useState<number | "">(initial?.subjectId ?? "");
  const sid = subjectId || subjects?.[0]?.id;
  const units = useLiveQuery(() => (sid ? db.units.where({ subjectId: sid }).sortBy("order") : []), [sid]);
  const topics = useLiveQuery(() => (sid ? db.topics.where({ subjectId: sid }).toArray() : []), [sid]);
  const [type, setType] = useState<ExamType>(initial?.type ?? mode ?? "end-term"); // new exams default to the mode
  const [date, setDate] = useState(initial?.date ?? "");
  const [time, setTime] = useState(initial?.time ?? "10:00");
  const [duration, setDuration] = useState(initial?.durationMins?.toString() ?? "180");
  const [scope, setScope] = useState<Set<number>>(new Set(initial?.topicIds ?? []));

  // The picker shows the syllabus of the exam's season (by type; "other" follows the app mode),
  // plus any unit that already has ticked topics so nothing saved is ever hidden.
  const season = examTypeMode(type) ?? mode ?? "end-term";
  const shownUnits = units?.filter((u) => unitInScope(u, season) || topics?.some((t) => t.unitId === u.id && scope.has(t.id!)));
  const hasSyllabus = !!shownUnits?.some((u) => topics?.some((t) => t.unitId === u.id));

  const toggle = (id: number) => setScope((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sid) return;
    const data = {
      subjectId: sid, type, date, time: time || undefined, durationMins: Number(duration) || undefined,
      topicIds: [...scope],
    };
    if (initial?.id) await db.exams.update(initial.id, data);
    else await db.exams.add({ ...data, checklist: DEFAULT_CHECKLIST });
    onDone(type);
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Subject">
        <Select value={sid ?? ""} onChange={(e) => { setSubjectId(Number(e.target.value)); setScope(new Set()); }}>
          {subjects?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Type"
          hint={mode && !examInMode({ type }, mode) ? `Belongs to ${modeShort(season).toLowerCase()} mode, so it won't show in this list` : undefined}
        >
          <Select value={type} onChange={(e) => setType(e.target.value as ExamType)}>
            {EXAM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Date"><Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Start time"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        <Field label="Duration (min)"><Input type="number" min={0} value={duration} onChange={(e) => setDuration(e.target.value)} /></Field>
      </div>
      {/* A fieldset, not <Field>: Field is a <label>, and a label around many checkboxes toggles the first one on any click. */}
      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-[13px] font-medium text-text/85">Syllabus for this exam</legend>
        <div className="max-h-48 space-y-2.5 overflow-y-auto rounded-lg border border-border bg-surface-2/50 p-3">
          {!hasSyllabus && (
            <p className="text-sm text-muted">No {season === "mid-term" ? "mid-sem" : "major"} syllabus for this subject yet. Type or paste it below.</p>
          )}
          {shownUnits?.map((u) => {
            const ts = topics?.filter((t) => t.unitId === u.id) ?? [];
            if (!ts.length) return null;
            const all = ts.every((t) => scope.has(t.id!));
            return (
              <div key={u.id}>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" className="accent-[var(--accent)]" checked={all} onChange={() => setScope((s) => {
                    const n = new Set(s);
                    for (const t of ts) if (all) n.delete(t.id!); else n.add(t.id!);
                    return n;
                  })} />
                  {u.title}
                </label>
                {ts.map((t) => (
                  <label key={t.id} className="ml-5 flex items-center gap-2 text-sm text-muted transition-colors duration-150 hover:text-text">
                    <input type="checkbox" className="accent-[var(--accent)]" checked={scope.has(t.id!)} onChange={() => toggle(t.id!)} /> {t.title}
                  </label>
                ))}
              </div>
            );
          })}
        </div>
        <span className="block text-xs text-muted">
          Leave everything unticked to cover the subject&apos;s whole {season === "mid-term" ? "mid-sem" : "major"} syllabus.
        </span>
        {/* Rendered once the syllabus has loaded, so it only opens by itself when there really is none. Keyed so it resets per subject and season. */}
        {sid && units && topics && (
          <ExamSyllabusInput
            key={`${sid}-${season}`}
            subjectId={sid}
            season={season}
            defaultOpen={!hasSyllabus}
            onAdded={(ids) => setScope((s) => new Set([...s, ...ids]))}
          />
        )}
      </fieldset>
      <div className="flex justify-end pt-1"><Button type="submit">Save exam</Button></div>
    </form>
  );
}
