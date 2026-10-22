"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, Check, Clock, MapPin, Plus, Printer, Trash2 } from "lucide-react";
import { Suspense, useState } from "react";
import { db } from "@/lib/db";
import { daysBetween, prettyDay, today } from "@/lib/dates";
import { examTypeLabel } from "@/lib/exams";
import { useExamMode } from "@/lib/mode";
import { examSyllabus } from "@/lib/planner";
import { Markdown } from "@/components/markdown";
import { toast } from "@/components/toast";
import { Button, Card, Empty, Input, List, Tick, cn } from "@/components/ui";

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
  const days = daysBetween(today(), exam.date);
  const checklist = exam.checklist;
  // Read-modify-write in one transaction so quick taps don't overwrite each other.
  const setChecklist = (change: (c: typeof checklist) => typeof checklist) =>
    db.transaction("rw", db.exams, async () => {
      const current = await db.exams.get(id);
      if (current) await db.exams.update(id, { checklist: change(current.checklist) });
    });
  const sheet = sheets?.length ? sheets[Math.min(sheetIdx, sheets.length - 1)] : undefined;
  const packed = checklist.filter((c) => c.done).length;

  return (
    <>
      <Link href="/exams" className="no-print mb-6 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-accent"><ArrowLeft size={14} /> Exams</Link>

      <header className="mb-8 flex flex-wrap items-end justify-between gap-6">
        <div className="flex items-end gap-5">
          <div>
            {days < 0 ? (
              <Check size={72} className="text-good" aria-hidden />
            ) : (
              <div className="numeral text-[88px] md:text-[112px]" style={{ color: days > 3 ? subject?.color : undefined }}>
                <span className={days <= 3 ? "mark" : undefined}>{days}</span>
              </div>
            )}
            <p className="mt-2 text-sm text-muted">{days === 0 ? "It's today" : days < 0 ? "Finished" : days === 1 ? "day left" : "days left"}</p>
          </div>
          <div className="min-w-0 pb-6">
            <h1 className="text-[28px] font-bold leading-tight tracking-tight md:text-[34px]">{subject?.name ?? "Exam"}</h1>
            <p className="mt-1 text-sm text-muted">{examTypeLabel(exam.type)}, {prettyDay(exam.date)}</p>
          </div>
        </div>
        <Button variant="secondary" className="no-print" onClick={() => window.print()}><Printer size={16} /> Print kit</Button>
      </header>

      <div className="space-y-6">
        <Card title="Exam details">
          <div className="space-y-1.5 text-[15px]">
            {exam.time && (
              <p className="flex items-center gap-2"><Clock size={15} className="text-muted" /> Starts {exam.time}{exam.durationMins ? `, ${exam.durationMins} min` : ""}</p>
            )}
            {(exam.venue || exam.seat) && (
              <p className="flex items-center gap-2"><MapPin size={15} className="text-muted" /> {[exam.venue, exam.seat && `Seat ${exam.seat}`].filter(Boolean).join(", ")}</p>
            )}
            <p className="text-muted">
              {scope.length} topic{scope.length === 1 ? "" : "s"} in the syllabus. {notDone.length} not started, {weak.length} weak.
            </p>
          </div>
          {exam.notes && <p className="mt-4 max-w-prose border-l-2 border-accent/40 pl-3 text-sm leading-relaxed">{exam.notes}</p>}
        </Card>

        {days <= 1 && days >= 0 && (
          <Card title="The night before">
            <ul className="max-w-prose list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed">
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
                  onClick={() => setChecklist((list) => list.map((c, j) => (j === i ? { ...c, done: !c.done } : c)))}
                />
                <span className={item.done ? "text-muted line-through" : ""}>{item.text}</span>
                <button
                  // Always visible on touch screens; on a mouse it appears on hover or keyboard focus.
                  className="no-print ml-auto rounded p-1.5 text-muted hover:text-bad md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                  aria-label={`Remove ${item.text}`}
                  onClick={async () => {
                    await setChecklist((list) => list.filter((_, j) => j !== i));
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
            <Button size="sm" type="submit" variant="secondary" className="h-9" aria-label="Add item"><Plus size={15} /></Button>
          </form>
        </Card>

        <Card
          title="Last-minute cheat sheet"
          action={sheets && sheets.length > 1 && (
            <select
              className="no-print h-8 rounded-lg border border-border bg-surface px-2 text-sm"
              value={Math.min(sheetIdx, sheets.length - 1)}
              onChange={(e) => setSheetIdx(Number(e.target.value))}
              aria-label="Choose cheat sheet"
            >
              {sheets.map((s, i) => <option key={s.id} value={i}>{s.title}</option>)}
            </select>
          )}
        >
          {sheet ? <Markdown>{sheet.content}</Markdown> : (
            <p className="text-sm text-muted">
              No cheat sheet yet. Generate one from{" "}
              <Link className="font-medium text-accent underline underline-offset-2" href={`/subjects/view?id=${exam.subjectId}`}>{subject?.name ?? "the subject"}, Notes tab</Link>.
            </p>
          )}
        </Card>

        <Card
          title="Weak topics"
          action={<Link className="no-print text-sm font-medium text-accent underline-offset-2 hover:underline" href="/revise">Revise</Link>}
        >
          {weak.length ? (
            <List className="border-y-0">
              {weak.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span>{t.title}</span>
                  <span className="shrink-0 text-xs text-warn">confidence {t.confidence}/5</span>
                </li>
              ))}
            </List>
          ) : <p className="text-sm text-muted">No weak topics flagged.</p>}
        </Card>
      </div>
    </>
  );
}
