"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, Check, Moon, Plus, Printer, Trash2 } from "lucide-react";
import { Suspense, useState } from "react";
import { db } from "@/lib/db";
import { daysBetween, prettyDay } from "@/lib/dates";
import { useToday } from "@/lib/use-today";
import { examTypeLabel } from "@/lib/exams";
import { examSyllabus, useExamMode } from "@/lib/mode";
import { Markdown } from "@/components/markdown";
import { toast } from "@/components/toast";
import { Badge, Button, Card, Empty, Input, List, Select, Tick, cn, subjectStyle } from "@/components/ui";

export default function ExamKitPage() {
  // The id is a query param, not a path segment, so this one prerendered (and precached) page serves every exam,
  // offline too. Ids only exist in IndexedDB, so the server could never build a page per exam.
  return (
    <Suspense>
      <ExamFromUrl />
    </Suspense>
  );
}

function ExamFromUrl() {
  const id = useSearchParams().get("id");
  // Keyed so opening another exam starts fresh, as a separate page would.
  return <ExamKit key={id} id={id ? Number(id) : NaN} />;
}

function ExamKit({ id }: { id: number }) {
  // A malformed URL id is not a valid IndexedDB key, so treat it as not found.
  const exam = useLiveQuery(async () => (Number.isFinite(id) ? ((await db.exams.get(id)) ?? null) : null), [id]);
  const subject = useLiveQuery(() => (exam ? db.subjects.get(exam.subjectId) : undefined), [exam?.subjectId]);
  const topics = useLiveQuery(() => (exam ? db.topics.where({ subjectId: exam.subjectId }).toArray() : []), [exam?.subjectId]);
  const units = useLiveQuery(() => (exam ? db.units.where({ subjectId: exam.subjectId }).toArray() : []), [exam?.subjectId]);
  const mode = useExamMode();
  const sheets = useLiveQuery(
    () => (exam ? db.docs.where({ subjectId: exam.subjectId }).filter((d) => d.kind === "cheatsheet").reverse().sortBy("createdAt") : []),
    [exam?.subjectId],
  );
  const [newItem, setNewItem] = useState("");
  const [sheetIdx, setSheetIdx] = useState(0);
  const day = useToday();

  if (exam === undefined) return null;
  if (exam === null) {
    return (
      <Empty title="Exam not found">
        It may have been deleted. <Link href="/exams" className="font-medium text-accent underline underline-offset-2">Back to exams</Link>
      </Empty>
    );
  }

  const scope = examSyllabus(exam, topics ?? [], units ?? [], mode); // the exam's own season's syllabus
  const weak = scope.filter((t) => t.weak || t.confidence <= 2);
  const notDone = scope.filter((t) => t.status === "not-started");
  const days = daysBetween(day, exam.date);
  const checklist = exam.checklist;
  // Read-modify-write in one transaction so quick taps don't overwrite each other.
  const setChecklist = (change: (c: typeof checklist) => typeof checklist) =>
    db.transaction("rw", db.exams, async () => {
      const current = await db.exams.get(id);
      if (current) await db.exams.update(id, { checklist: change(current.checklist) });
    });
  // Where a drawn item is in the stored list now. Its drawn index alone can be stale: a double-tapped delete
  // would remove the item that moved up into its place.
  const indexOf = (list: typeof checklist, item: (typeof checklist)[number], i: number) =>
    list[i]?.text === item.text ? i : list.findIndex((c) => c.text === item.text);
  const sheet = sheets?.length ? sheets[Math.min(sheetIdx, sheets.length - 1)] : undefined;
  const packed = checklist.filter((c) => c.done).length;

  return (
    <>
      <Link
        href="/exams"
        className="group no-print mb-6 inline-flex items-center gap-1 rounded-md text-sm font-medium text-muted transition-colors duration-150 hover:text-text"
      >
        <ArrowLeft size={14} className="transition-transform duration-200 ease-snappy group-hover:-translate-x-0.5" /> Exams
      </Link>

      {/* The countdown leads, like the days column of a printed date sheet, marked in amber once it's three days or less. */}
      <header className="mb-10 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-stretch gap-5 md:gap-6">
          <div className="shrink-0">
            {days < 0 ? (
              <Check size={56} strokeWidth={1.75} className="text-good" aria-hidden />
            ) : (
              <div className="numeral subj-ink text-[72px] md:text-[88px]" style={subjectStyle(subject?.color)}>
                <span className={days <= 3 ? "mark" : undefined}>{days}</span>
              </div>
            )}
            <p className="mt-2 text-[13px] text-muted">{days === 0 ? "It's today" : days < 0 ? "Finished" : days === 1 ? "day left" : "days left"}</p>
          </div>
          <div style={subjectStyle(subject?.color)} className="flex min-w-0 flex-col justify-center border-l-[3px] border-[var(--subj,var(--border))] pl-5 md:pl-6">
            <h1 className="break-words font-display text-[28px] leading-[1.1] md:text-[34px]">{subject?.name ?? "Exam"}</h1>
            <p className="mt-1 flex items-center gap-2 text-[15px] text-muted">
              {examTypeLabel(exam.type)}, {prettyDay(exam.date)}
            </p>
          </div>
        </div>
        <Button variant="secondary" className="no-print" onClick={() => window.print()}><Printer size={16} /> Print kit</Button>
      </header>

      <div className="space-y-6">
        <Card title="Exam details">
          {/* Ruled label and value rows, like the particulars block on an admit card. */}
          <dl className="divide-y divide-border border-y border-border text-[15px]">
            {exam.time && (
              <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 py-2.5">
                <dt className="text-[13px] leading-6 text-muted">Starts</dt>
                <dd className="tabular-nums">{exam.time}{exam.durationMins ? `, ${exam.durationMins} min` : ""}</dd>
              </div>
            )}
            {(exam.venue || exam.seat) && (
              <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 py-2.5">
                <dt className="text-[13px] leading-6 text-muted">Venue</dt>
                <dd className="break-words">{[exam.venue, exam.seat && `Seat ${exam.seat}`].filter(Boolean).join(", ")}</dd>
              </div>
            )}
            <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 py-2.5">
              <dt className="text-[13px] leading-6 text-muted">Syllabus</dt>
              <dd>{scope.length} topic{scope.length === 1 ? "" : "s"} in the syllabus. {notDone.length} not started, {weak.length} weak.</dd>
            </div>
          </dl>
          {exam.notes && <p className="mt-4 max-w-prose border-l-2 border-border pl-3 text-sm leading-relaxed">{exam.notes}</p>}
        </Card>

        {days <= 1 && days >= 0 && (
          <Card
            className="border-mark/50 bg-mark-soft"
            title={<span className="flex items-center gap-2"><Moon size={16} className="text-warn" aria-hidden /> The night before</span>}
          >
            <ul className="max-w-prose list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed marker:text-muted">
              <li>Don&apos;t start new topics. Skim the cheat sheet and the weak topics below.</li>
              <li>Pack the checklist tonight and keep the admit card in your bag.</li>
              <li>Sleep 7–8 hours. Memory consolidates while you sleep.</li>
              <li>Set two alarms. Leave so you reach {exam.venue ?? "the venue"} 30–45 min early.</li>
              <li>In the hall, read the whole paper first and attempt your strongest questions first.</li>
            </ul>
          </Card>
        )}

        <Card title="Checklist" action={<span className={cn("text-sm tabular-nums", checklist.length && packed === checklist.length ? "font-semibold text-good" : "text-muted")}>{packed} of {checklist.length} packed</span>}>
          <List className="border-t-0">
            {checklist.map((item, i) => (
              <li key={i} className="group flex items-center gap-3 py-2.5 text-[15px]">
                <Tick
                  done={item.done}
                  label={item.done ? `Unpack ${item.text}` : `Pack ${item.text}`}
                  onClick={() => setChecklist((list) => {
                    const at = indexOf(list, item, i);
                    return list.map((c, j) => (j === at ? { ...c, done: !item.done } : c));
                  })}
                />
                <span className={cn("min-w-0 break-words transition-colors duration-150", item.done && "text-muted line-through decoration-muted/60")}>{item.text}</span>
                <button
                  // Always visible on touch screens; on a mouse it appears on hover or keyboard focus.
                  className="no-print ml-auto shrink-0 rounded-lg p-1.5 text-muted transition-[opacity,color,background-color] duration-150 hover:bg-bad/10 hover:text-bad md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                  aria-label={`Remove ${item.text}`}
                  onClick={async () => {
                    let removed = false;
                    await setChecklist((list) => {
                      const at = indexOf(list, item, i);
                      removed = at >= 0;
                      return list.filter((_, j) => j !== at);
                    });
                    if (!removed) return; // a second tap on an item that's already gone
                    toast(`Removed ${item.text}`, {
                      label: "Undo",
                      onClick: () => void setChecklist((list) => [...list.slice(0, i), item, ...list.slice(i)]),
                    });
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </List>
          <form
            className="no-print mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newItem.trim()) return;
              const text = newItem.trim();
              setChecklist((list) => [...list, { text, done: false }]);
              setNewItem("");
            }}
          >
            <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add an item" className="h-9" />
            <Button type="submit" variant="secondary" className="w-9 shrink-0 px-0" aria-label="Add item"><Plus size={15} /></Button>
          </form>
        </Card>

        <Card
          title="Last-minute cheat sheet"
          action={sheets && sheets.length > 1 && (
            <Select
              className="no-print h-8 w-auto max-w-[11rem] px-2 py-0"
              value={Math.min(sheetIdx, sheets.length - 1)}
              onChange={(e) => setSheetIdx(Number(e.target.value))}
              aria-label="Choose cheat sheet"
            >
              {sheets.map((s, i) => <option key={s.id} value={i}>{s.title}</option>)}
            </Select>
          )}
        >
          {sheet ? <Markdown>{sheet.content}</Markdown> : (
            <p className="text-sm text-muted">
              No cheat sheet yet. Generate one from{" "}
              <Link className="font-medium text-accent underline underline-offset-2" href={`/subjects/view?id=${exam.subjectId}`}>{subject?.name ?? "the subject"}, Notes tab</Link>.
            </p>
          )}
        </Card>

        <Card title="Weak topics">
          {weak.length ? (
            <List className="border-b-0">
              {weak.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-[15px]">
                  <span className="min-w-0 break-words">{t.title}</span>
                  <Badge className="shrink-0 bg-bad/10 text-bad">weak</Badge>
                </li>
              ))}
            </List>
          ) : <p className="text-sm text-muted">No weak topics flagged.</p>}
        </Card>
      </div>
    </>
  );
}
