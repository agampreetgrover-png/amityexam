"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Briefcase, Check, Clock, FileSpreadsheet, GraduationCap, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { db, deleteExam } from "@/lib/db";
import { daysBetween, prettyDay } from "@/lib/dates";
import { useToday } from "@/lib/use-today";
import { byWhen, DEFAULT_CHECKLIST, EXAM_TYPES, examTypeLabel, urgency, type Urgency } from "@/lib/exams";
import { examInMode, examSyllabus, examTypeMode, modeShort, unitInScope, useExamMode } from "@/lib/mode";
import type { Exam, ExamMode, ExamType } from "@/lib/types";
import { Badge, Button, Empty, Field, Input, Menu, Modal, PageHeader, Progress, Section, Select, buttonClass, cn, subjectStyle } from "@/components/ui";
import { DatesheetImport, type ImportDraft } from "@/components/exams/datesheet-import";
import { toast } from "@/components/toast";
import { ExamSyllabusInput } from "@/components/exam-syllabus-input";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The countdown block and the timeline dot, by how close the exam is: coral under a week, amber under two.
const COUNTDOWN: Record<Urgency, string> = {
  critical: "border-critical/25 bg-critical-soft text-critical",
  soon: "border-mark/25 bg-mark-soft text-mark-ink",
  later: "border-border bg-surface-2 text-text",
  past: "border-border bg-surface-2 text-muted",
};
const DOT: Record<Urgency, string> = {
  critical: "border-critical-fill bg-critical-fill",
  soon: "border-mark bg-mark",
  later: "border-line-strong bg-surface",
  past: "border-border bg-surface-3",
};

/** Consecutive exams on the same day, in the order given. */
function byDay(list: Exam[]) {
  const days: { date: string; exams: Exam[] }[] = [];
  for (const e of list) {
    if (days.at(-1)?.date === e.date) days.at(-1)!.exams.push(e);
    else days.push({ date: e.date, exams: [e] });
  }
  return days;
}

export default function ExamsPage() {
  const exams = useLiveQuery(() => db.exams.toArray().then((es) => es.sort(byWhen)));
  const subjects = useLiveQuery(() => db.subjects.toArray());
  // Every subject's syllabus, for each card's "revised" count; small enough to hold whole.
  const topics = useLiveQuery(() => db.topics.toArray());
  const units = useLiveQuery(() => db.units.toArray());
  const [editing, setEditing] = useState<Exam | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  // Held here, not in the dialog (its content unmounts on close), so an accidental Esc doesn't lose the review.
  const [importDraft, setImportDraft] = useState<ImportDraft | null>(null);
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

  // The ribbon always counts this mode's papers, whatever "Show all" shows below it.
  const ahead = inMode.filter((e) => e.date >= t);
  const first = ahead[0];
  const firstIn = first ? daysBetween(t, first.date) : 0;
  const gap = ahead.length > 1 ? Math.round(daysBetween(first.date, ahead.at(-1)!.date) / (ahead.length - 1)) : undefined;

  const card = (e: Exam, isPast: boolean) => {
    const s = subject(e.subjectId);
    const days = daysBetween(t, e.date);
    const u = urgency(days);
    const scope = topics && units ? examSyllabus(e, topics.filter((x) => x.subjectId === e.subjectId), units, mode) : [];
    const revised = scope.filter((x) => x.status === "revised").length;
    const name = s?.name ?? "this";
    const Name = isPast ? "h4" : "h3"; // under the day's heading, which sits a level lower in "Past exams"
    return (
      <li
        key={e.id}
        style={subjectStyle(s?.color)}
        className="grid grid-cols-[4.25rem_minmax(0,1fr)] items-start gap-x-4 gap-y-3 rounded-xl border border-border bg-surface p-4 shadow-sheet @2xl:grid-cols-[4.25rem_minmax(0,1fr)_auto] @2xl:items-center"
      >
        <div className={cn("flex h-[4.25rem] flex-col items-center justify-center rounded-lg border text-center", COUNTDOWN[u])}>
          {days < 0 ? (
            <Check size={22} strokeWidth={2.2} aria-hidden />
          ) : days === 0 ? (
            <span className="text-[15px] font-bold tracking-[-0.01em]">Today</span>
          ) : (
            <span className="numeral text-[28px]">{days}</span>
          )}
          {days !== 0 && <span className="mt-1 text-[11px] font-medium">{days < 0 ? "Done" : days === 1 ? "day left" : "days left"}</span>}
        </div>

        <div className="min-w-0 space-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span aria-hidden className="subj-dot size-2 shrink-0 rounded-full" />
            <Name className={cn("min-w-0 break-words text-[15px] font-semibold tracking-[-0.01em]", isPast && "font-medium text-muted")}>{s?.name ?? "Unknown subject"}</Name>
            {s?.code && <Badge>{s.code}</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-muted">
            <span>{examTypeLabel(e.type)}</span>
            {e.time && (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Clock size={13} className="text-faint" aria-hidden />
                {e.time}{e.durationMins ? `, ${e.durationMins} min` : ""}
              </span>
            )}
            {!isPast || e.venue ? <RoomField exam={e} /> : null}
            {e.seat && <Badge>Seat {e.seat}</Badge>}
          </div>
        </div>

        <div className="col-span-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 @2xl:col-span-1 @2xl:justify-end">
          {scope.length > 0 ? (
            <Link
              href={`/subjects/view?id=${e.subjectId}&tab=syllabus`}
              title="Open the syllabus to tick topics off"
              className="group -mx-1.5 rounded-md px-1.5 py-1 transition-colors duration-150 hover:bg-surface-2"
            >
              <span className="block text-[12px] tabular-nums text-muted group-hover:text-text">
                <strong className="font-semibold text-text">{revised}/{scope.length}</strong> topics revised
              </span>
              <Progress value={(revised / scope.length) * 100} className="mt-1.5 w-32" label={`${revised} of ${scope.length} topics revised`} />
            </Link>
          ) : (
            <span className="text-[12px] text-faint">No syllabus yet</span>
          )}
          <div className="flex items-center gap-1">
            <Link href={`/exams/view?id=${e.id}`} className={buttonClass("secondary", "sm")}>
              <Briefcase size={14} className="text-muted" aria-hidden /> Exam kit
            </Link>
            <Menu
              label={`Actions for the ${name} exam`}
              items={[
                { label: "Edit", icon: <Pencil size={14} aria-hidden />, onSelect: () => setEditing(e) },
                { label: "Delete", icon: <Trash2 size={14} aria-hidden />, danger: true, onSelect: () => confirm("Delete this exam?") && deleteExam(e.id!) },
              ]}
            />
          </div>
        </div>
      </li>
    );
  };

  // A vertical timeline: one dot per exam day on a hairline, that day's papers stacked beside it.
  const timeline = (list: Exam[], isPast = false) => {
    const days = byDay(list);
    const Day = isPast ? "h3" : "h2"; // past days sit under the "Past exams" heading
    return (
      <ol className="@container">
        {days.map((d, i) => {
          const n = daysBetween(t, d.date);
          const prev = !isPast && i > 0 ? daysBetween(days[i - 1].date, d.date) : 0;
          return (
            <li
              key={d.date}
              className="relative pb-7 pl-7 before:absolute before:-bottom-1 before:left-[5px] before:top-4 before:w-px before:bg-border last:pb-0 last:before:hidden sm:pl-9"
            >
              <span aria-hidden className={cn("absolute left-0 top-1 size-[11px] rounded-full border-2", DOT[urgency(n)])} />
              <Day className="flex flex-wrap items-baseline gap-x-2 text-[13px] leading-5">
                <time dateTime={d.date} className={cn("font-semibold tabular-nums", isPast ? "text-muted" : "text-text")}>{prettyDay(d.date)}</time>
                {prev > 0 && <span className="tabular-nums text-faint">{plural(prev, "day")} after the previous paper</span>}
              </Day>
              <ul className="mt-3 space-y-2.5">{d.exams.map((e) => card(e, isPast))}</ul>
            </li>
          );
        })}
      </ol>
    );
  };

  const tile = (label: string, value: string, sub?: string) => (
    <div className="min-w-0 rounded-xl border border-border bg-surface px-2.5 py-2.5 shadow-sheet sm:px-4 sm:py-3.5">
      <p className="truncate text-[11px] text-muted sm:text-[13px]">{label}</p>
      <p className="mt-1 text-[16px] font-semibold tabular-nums tracking-[-0.02em] sm:text-[22px]">{value}</p>
      {sub && <p className="mt-0.5 truncate text-[11px] text-muted sm:text-[12px]">{sub}</p>}
    </div>
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
      {first && (
        // On phones a compact strip, the date's tile a little wider so "Wed, 12 Nov" stays on one line.
        <section
          aria-label="Summary"
          className={cn("mb-8 grid gap-2 sm:gap-3", gap === undefined ? "grid-cols-2" : "grid-cols-[minmax(0,4fr)_minmax(0,5fr)_minmax(0,4fr)] sm:grid-cols-3")}
        >
          {tile("Papers", String(ahead.length), mode ? `${modeShort(mode)}, still to sit` : "Still to sit")}
          {tile("First exam", prettyDay(first.date), `${subject(first.subjectId)?.name ?? "Exam"}, ${firstIn === 0 ? "today" : `in ${plural(firstIn, "day")}`}`)}
          {gap !== undefined && tile("Average gap", plural(gap, "day"), "Between papers")}
        </section>
      )}
      {mode && (hidden > 0 || showAll) && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-muted">
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
      {upcoming.length > 0 && timeline(upcoming)}
      {past.length > 0 && (
        <Section title="Past exams" className="mt-10">
          {timeline(past, true)}
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
        <DatesheetImport draft={importDraft} onDraft={setImportDraft} onDone={() => setImporting(false)} />
      </Modal>
    </>
  );
}

/**
 * The exam's room as a badge, or an "Add room" chip when the date sheet didn't have one. Either opens a small
 * field in place: Enter saves straight to the exam, Escape cancels, and clicking away keeps what was typed.
 */
function RoomField({ exam }: { exam: Exam }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const done = useRef(false); // set once Enter or Escape has dealt with it, so the blur that follows doesn't save again
  // Closed from the keyboard, focus goes back to the chip instead of falling to the page; clicking away leaves it be.
  const [refocus, setRefocus] = useState(false);
  const save = async (keyboard = false) => {
    if (done.current) return;
    done.current = true;
    setRefocus(keyboard);
    setOpen(false);
    const venue = value.trim() || undefined;
    if (venue === exam.venue) return;
    try {
      await db.exams.update(exam.id!, { venue });
    } catch {
      toast("Couldn't save the room. Try again.");
    }
  };
  if (open) {
    return (
      <Input
        autoFocus
        aria-label="Room"
        placeholder="Room, e.g. E3-204"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            done.current = true;
            setRefocus(true);
            setOpen(false);
          }
        }}
        className="h-7 w-40 px-2 py-0 text-xs"
      />
    );
  }
  const start = () => {
    done.current = false;
    setValue(exam.venue ?? "");
    setOpen(true);
  };
  return exam.venue ? (
    <button type="button" autoFocus={refocus} onClick={start} title="Change room" aria-label={`Room ${exam.venue}, change`} className="rounded-md transition-colors duration-150 hover:opacity-80">
      <Badge><MapPin aria-hidden /> {exam.venue}</Badge>
    </button>
  ) : (
    <button
      type="button"
      autoFocus={refocus}
      onClick={start}
      className="inline-flex items-center gap-1 rounded-md border border-dashed border-line-strong px-2 py-0.5 text-xs font-medium text-muted transition-colors duration-150 hover:border-accent hover:text-accent"
    >
      <Plus size={12} aria-hidden /> Add room
    </button>
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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

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
    // The guard stops a double tap adding the exam twice.
    if (!sid || saving) return;
    setSaving(true);
    setSaveError(false);
    const data = {
      subjectId: sid, type, date, time: time || undefined, durationMins: Number(duration) || undefined,
      topicIds: [...scope],
    };
    try {
      if (initial?.id) await db.exams.update(initial.id, data);
      else await db.exams.add({ ...data, checklist: DEFAULT_CHECKLIST });
      onDone(type);
    } catch {
      setSaving(false);
      setSaveError(true);
    }
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
        <div className="max-h-48 space-y-2.5 overflow-y-auto rounded-xl border border-border bg-surface-2/50 p-3">
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
      {saveError && <p className="text-sm text-bad" role="alert">Couldn&apos;t save the exam. Try again.</p>}
      <div className="flex justify-end pt-1"><Button type="submit" disabled={saving}>Save exam</Button></div>
    </form>
  );
}
