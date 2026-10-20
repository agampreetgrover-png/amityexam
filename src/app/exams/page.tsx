"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Briefcase, Check, GraduationCap, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { db, deleteExam } from "@/lib/db";
import { daysBetween, prettyDay, today } from "@/lib/dates";
import { DEFAULT_CHECKLIST, EXAM_TYPES, examTypeLabel } from "@/lib/exams";
import type { Exam, ExamType } from "@/lib/types";
import { Button, Empty, Field, Input, List, Modal, PageHeader, Section, Select, Textarea } from "@/components/ui";

export default function ExamsPage() {
  const exams = useLiveQuery(() => db.exams.orderBy("date").toArray());
  const subjects = useLiveQuery(() => db.subjects.toArray());
  const [editing, setEditing] = useState<Exam | null>(null);
  const [adding, setAdding] = useState(false);
  const t = today();
  const subject = (id: number) => subjects?.find((s) => s.id === id);
  const upcoming = exams?.filter((e) => e.date >= t) ?? [];
  const past = exams?.filter((e) => e.date < t).reverse() ?? [];

  const row = (e: Exam) => {
    const s = subject(e.subjectId);
    const days = daysBetween(t, e.date);
    const soon = days >= 0 && days <= 3;
    return (
      <li key={e.id} className="flex items-center gap-4 py-4">
        <div className="w-14 shrink-0">
          {days >= 0 ? (
            <div className="numeral text-[40px]" style={{ color: soon ? undefined : s?.color }}>
              <span className={soon ? "mark" : undefined}>{days}</span>
            </div>
          ) : (
            <Check size={26} className="text-muted" aria-hidden />
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
            className="mr-1 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-[13px] font-medium hover:bg-surface-2"
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
          Every exam belongs to a subject. <Link className="font-medium text-text underline underline-offset-2" href="/subjects">Add your subjects</Link>
        </Empty>
      )}
      {subjects?.length !== 0 && exams?.length === 0 && (
        <Empty icon={<GraduationCap size={28} />} title="No exams yet">Add your date sheet so the planner can schedule study time.</Empty>
      )}
      {upcoming.length > 0 && <List>{upcoming.map(row)}</List>}
      {past.length > 0 && (
        <Section title="Past exams" className="mt-10">
          <List className="opacity-60">{past.map(row)}</List>
        </Section>
      )}
      <Modal open={adding || !!editing} onClose={() => { setAdding(false); setEditing(null); }} title={editing ? "Edit exam" : "Add exam"}>
        <ExamForm initial={editing} onDone={() => { setAdding(false); setEditing(null); }} />
      </Modal>
    </>
  );
}

function ExamForm({ initial, onDone }: { initial: Exam | null; onDone: () => void }) {
  const subjects = useLiveQuery(() => db.subjects.orderBy("name").toArray());
  const [subjectId, setSubjectId] = useState<number | "">(initial?.subjectId ?? "");
  const sid = subjectId || subjects?.[0]?.id;
  const units = useLiveQuery(() => (sid ? db.units.where({ subjectId: sid }).sortBy("order") : []), [sid]);
  const topics = useLiveQuery(() => (sid ? db.topics.where({ subjectId: sid }).toArray() : []), [sid]);
  const [type, setType] = useState<ExamType>(initial?.type ?? "end-term");
  const [date, setDate] = useState(initial?.date ?? "");
  const [time, setTime] = useState(initial?.time ?? "10:00");
  const [duration, setDuration] = useState(initial?.durationMins?.toString() ?? "180");
  const [venue, setVenue] = useState(initial?.venue ?? "");
  const [seat, setSeat] = useState(initial?.seat ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [scope, setScope] = useState<Set<number>>(new Set(initial?.topicIds ?? []));

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
      <Field label="Syllabus for this exam" hint="Leave everything unticked to include every topic of the subject, e.g. for an end-term.">
        <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-border p-3">
          {!topics?.length && <p className="text-sm text-muted">No topics yet. Add the syllabus on the subject page.</p>}
          {units?.map((u) => {
            const ts = topics?.filter((t) => t.unitId === u.id) ?? [];
            if (!ts.length) return null;
            const all = ts.every((t) => scope.has(t.id!));
            return (
              <div key={u.id}>
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" className="accent-[var(--text)]" checked={all} onChange={() => setScope((s) => {
                    const n = new Set(s);
                    for (const t of ts) if (all) n.delete(t.id!); else n.add(t.id!);
                    return n;
                  })} />
                  {u.title}
                </label>
                {ts.map((t) => (
                  <label key={t.id} className="ml-5 flex items-center gap-2 text-sm text-muted">
                    <input type="checkbox" className="accent-[var(--text)]" checked={scope.has(t.id!)} onChange={() => toggle(t.id!)} /> {t.title}
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
