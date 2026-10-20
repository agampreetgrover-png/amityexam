"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Briefcase, Check, GraduationCap, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { db, deleteExam } from "@/lib/db";
import { daysBetween, prettyDay, today } from "@/lib/dates";
import { DEFAULT_CHECKLIST, EXAM_TYPES, examTypeLabel } from "@/lib/exams";
import { examInMode, examTypeMode, modeShort, unitMode, useExamMode } from "@/lib/mode";
import type { Exam, ExamMode, ExamType } from "@/lib/types";
import { Button, Empty, Field, Input, Modal, PageHeader, Section, Select, Textarea } from "@/components/ui";

export default function ExamsPage() {
  const exams = useLiveQuery(() => db.exams.orderBy("date").toArray());
  const subjects = useLiveQuery(() => db.subjects.toArray());
  const [editing, setEditing] = useState<Exam | null>(null);
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const mode = useExamMode();
  const t = today();
  const subject = (id: number) => subjects?.find((s) => s.id === id);
  // Only this mode's exams unless "Show all" is ticked.
  const inMode = exams?.filter((e) => examInMode(e, mode)) ?? [];
  const hidden = (exams?.length ?? 0) - inMode.length;
  const shown = showAll ? (exams ?? []) : inMode;
  const upcoming = shown.filter((e) => e.date >= t);
  const past = shown.filter((e) => e.date < t).reverse();

  const row = (e: Exam) => {
    const s = subject(e.subjectId);
    const days = daysBetween(t, e.date);
    const soon = days >= 0 && days <= 3;
    return (
      <li
        key={e.id}
        className="relative flex items-center gap-3 overflow-hidden rounded-2xl border border-border bg-surface py-4 pl-5 pr-3 shadow-[0_1px_3px_rgb(17_24_39/0.04)] sm:gap-4 sm:py-5 sm:pl-6 sm:pr-4"
      >
        <span className="absolute inset-y-0 left-0 w-1" style={{ background: s?.color }} aria-hidden />
        <div className="w-14 shrink-0">
          {days >= 0 ? (
            <div className="numeral text-[40px]" style={{ color: soon ? undefined : s?.color }}>
              <span className={soon ? "mark" : undefined}>{days}</span>
            </div>
          ) : (
            <Check size={26} className="text-good" aria-hidden />
          )}
          <div className="mt-1.5 text-xs text-muted">{days === 0 ? "today" : days > 0 ? (days === 1 ? "day" : "days") : "done"}</div>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-semibold">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s?.color }} />
            <span className="truncate">{s?.name ?? "Unknown subject"}</span>
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            {examTypeLabel(e.type)}, {prettyDay(e.date)}{e.time && ` at ${e.time}`}
          </p>
          {(e.venue || e.seat) && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
              <MapPin size={12} /> {[e.venue, e.seat && `Seat ${e.seat}`].filter(Boolean).join(", ")}
            </p>
          )}
          {e.topicIds.length > 0 && <p className="mt-0.5 text-xs text-muted">{e.topicIds.length} topics in scope</p>}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Link
            href={`/exams/${e.id}`}
            className="mr-1 inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent-soft px-2.5 text-[13px] font-medium text-accent hover:bg-accent/10"
          >
            <Briefcase size={14} /> Kit
          </Link>
          <Button variant="ghost" size="sm" aria-label="Edit" onClick={() => setEditing(e)}><Pencil size={15} /></Button>
          <Button variant="danger" size="sm" aria-label="Delete" onClick={() => confirm("Delete this exam?") && deleteExam(e.id!)}><Trash2 size={15} /></Button>
        </div>
      </li>
    );
  };

  return (
    <>
      <PageHeader
        title="Exams"
        sub="Your date sheet, venues and exam-day kits"
        action={<Button onClick={() => setAdding(true)} disabled={!subjects?.length}><Plus size={16} /> Add exam</Button>}
      />
      {subjects?.length === 0 && (
        <Empty icon={<GraduationCap size={28} />} title="Add a subject first">
          Every exam belongs to a subject. <Link className="font-medium text-accent underline underline-offset-2" href="/subjects">Add your subjects</Link>
        </Empty>
      )}
      {mode && (hidden > 0 || showAll) && (
        <div className="-mt-4 mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-muted">
          <span>
            {showAll ? "Showing every exam" : `Showing ${modeShort(mode).toLowerCase()} exams, ${hidden} other${hidden === 1 ? "" : "s"} hidden`}
          </span>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" className="accent-[var(--accent)]" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show all exams
          </label>
        </div>
      )}
      {subjects?.length !== 0 && exams?.length === 0 && (
        <Empty icon={<GraduationCap size={28} />} title="No exams yet">Add your date sheet so the planner can schedule study time.</Empty>
      )}
      {mode && !!exams?.length && !shown.length && (
        <Empty icon={<GraduationCap size={28} />} title={`No ${modeShort(mode).toLowerCase()} exams yet`}>
          Add your {mode === "mid-term" ? "mid-sem" : "end-sem"} date sheet so the planner can schedule study time.
        </Empty>
      )}
      {upcoming.length > 0 && <ul className="space-y-3">{upcoming.map(row)}</ul>}
      {past.length > 0 && (
        <Section title="Past exams" className="mt-10">
          <ul className="space-y-3 opacity-60">{past.map(row)}</ul>
        </Section>
      )}
      <Modal open={adding || !!editing} onClose={() => { setAdding(false); setEditing(null); }} title={editing ? "Edit exam" : "Add exam"}>
        <ExamForm initial={editing} mode={mode} onDone={() => { setAdding(false); setEditing(null); }} />
      </Modal>
    </>
  );
}

function ExamForm({ initial, mode, onDone }: { initial: Exam | null; mode?: ExamMode; onDone: () => void }) {
  const subjects = useLiveQuery(() => db.subjects.orderBy("name").toArray());
  const [subjectId, setSubjectId] = useState<number | "">(initial?.subjectId ?? "");
  const sid = subjectId || subjects?.[0]?.id;
  const units = useLiveQuery(() => (sid ? db.units.where({ subjectId: sid }).sortBy("order") : []), [sid]);
  const topics = useLiveQuery(() => (sid ? db.topics.where({ subjectId: sid }).toArray() : []), [sid]);
  const [type, setType] = useState<ExamType>(initial?.type ?? mode ?? "end-term"); // new exams default to the mode
  const [date, setDate] = useState(initial?.date ?? "");
  const [time, setTime] = useState(initial?.time ?? "10:00");
  const [duration, setDuration] = useState(initial?.durationMins?.toString() ?? "180");
  const [venue, setVenue] = useState(initial?.venue ?? "");
  const [seat, setSeat] = useState(initial?.seat ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [scope, setScope] = useState<Set<number>>(new Set(initial?.topicIds ?? []));

  // The picker shows the syllabus of the exam's season (by type; "other" follows the app mode),
  // plus any unit that already has ticked topics so nothing saved is ever hidden.
  const season = examTypeMode(type) ?? mode ?? "end-term";
  const shownUnits = units?.filter((u) => unitMode(u) === season || topics?.some((t) => t.unitId === u.id && scope.has(t.id!)));

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
      venue: venue || undefined, seat: seat || undefined, notes: notes || undefined, topicIds: [...scope],
    };
    if (initial?.id) await db.exams.update(initial.id, data);
    else await db.exams.add({ ...data, checklist: DEFAULT_CHECKLIST });
    onDone();
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Subject">
        <Select value={sid ?? ""} onChange={(e) => { setSubjectId(Number(e.target.value)); setScope(new Set()); }}>
          {subjects?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value as ExamType)}>
            {EXAM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Date"><Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Start time"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        <Field label="Duration (min)"><Input type="number" min={0} value={duration} onChange={(e) => setDuration(e.target.value)} /></Field>
        <Field label="Venue or block"><Input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="E2 Block, Room 304" /></Field>
        <Field label="Seat no."><Input value={seat} onChange={(e) => setSeat(e.target.value)} /></Field>
      </div>
      <Field
        label="Syllabus for this exam"
        hint={`Leave everything unticked to cover the subject's whole ${season === "mid-term" ? "mid-sem" : "major"} syllabus.`}
      >
        <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-border p-3">
          {!shownUnits?.some((u) => topics?.some((t) => t.unitId === u.id)) && (
            <p className="text-sm text-muted">No {season === "mid-term" ? "mid-sem" : "major"} syllabus yet. Add it on the subject page, in that exam mode.</p>
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
                  <label key={t.id} className="ml-5 flex items-center gap-2 text-sm text-muted">
                    <input type="checkbox" className="accent-[var(--accent)]" checked={scope.has(t.id!)} onChange={() => toggle(t.id!)} /> {t.title}
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      </Field>
      <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Open book? Allowed materials, marking scheme…" /></Field>
      <div className="flex justify-end pt-1"><Button type="submit">Save exam</Button></div>
    </form>
  );
}
