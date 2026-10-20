"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { modeShort, topicsInScope, unitInScope, useExamMode } from "@/lib/mode";
import { coverage } from "@/lib/stats";
import { Empty, Progress, Tabs, cn } from "@/components/ui";
import { SyllabusTab } from "@/components/subject/syllabus-tab";
import { MaterialsTab } from "@/components/subject/materials-tab";
import { NotesTab } from "@/components/subject/notes-tab";
import { QuizTab } from "@/components/subject/quiz-tab";
import { PredictTab } from "@/components/subject/predict-tab";
import { ChatTab } from "@/components/subject/chat-tab";

const TABS = [
  { key: "syllabus", label: "Syllabus", C: SyllabusTab },
  { key: "materials", label: "Materials", C: MaterialsTab },
  { key: "notes", label: "Notes", C: NotesTab },
  { key: "quiz", label: "Quiz", C: QuizTab },
  { key: "predict", label: "Predict", C: PredictTab },
  { key: "chat", label: "Ask", C: ChatTab },
] as const;

export default function SubjectPage() {
  const { id } = useParams<{ id: string }>();
  const subjectId = Number(id);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("syllabus");

  const valid = Number.isInteger(subjectId);

  // null = not found; undefined = still loading. A bad id (e.g. /subjects/abc) is treated as not found
  // rather than handed to Dexie, which rejects NaN keys.
  const subject = useLiveQuery(async () => (valid ? ((await db.subjects.get(subjectId)) ?? null) : null), [subjectId, valid]);
  const allUnits = useLiveQuery(() => (valid ? db.units.where({ subjectId }).sortBy("order") : []), [subjectId, valid]) ?? [];
  const allTopics = useLiveQuery(() => (valid ? db.topics.where({ subjectId }).toArray() : []), [subjectId, valid]) ?? [];
  const mode = useExamMode();

  // Wait for the mode too, so the other syllabus never flashes up.
  if (subject === undefined || !mode) return <p className="text-sm text-muted">Loading…</p>;
  if (!subject) return <Empty title="Subject not found"><Link href="/subjects" className="font-medium text-accent underline underline-offset-2">Back to subjects</Link></Empty>;

  // Every tab works on the current mode's own syllabus.
  const units = allUnits.filter((u) => unitInScope(u, mode));
  const topics = topicsInScope(allTopics, allUnits, mode);
  const pct = coverage(topics);
  const Active = TABS.find((t) => t.key === tab)!.C;

  return (
    <div>
      <Link href="/subjects" className="no-print mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-accent">
        <ArrowLeft size={14} /> Subjects
      </Link>
      <header className="no-print mb-6 flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-baseline gap-3 text-[28px] font-bold leading-tight tracking-tight md:text-[34px]">
            <span className="h-3 w-3 shrink-0 -translate-y-0.5 rounded-full" style={{ background: subject.color }} />
            <span className="min-w-0 break-words">{subject.name}</span>
          </h1>
          <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-muted">
            {subject.code && <span>{subject.code}</span>}
            {subject.credits ? <span>{subject.credits} credits</span> : null}
            <span>{topics.length} {modeShort(mode).toLowerCase()} topics</span>
          </p>
        </div>
        <div className="w-full rounded-2xl border border-border bg-surface px-4 py-3 shadow-[0_1px_3px_rgb(17_24_39/0.04)] sm:w-56">
          <div className="mb-1.5 flex justify-between text-[13px]">
            <span className="text-muted">Syllabus covered</span>
            <span className={cn("font-semibold tabular-nums", pct < 50 ? "text-warn" : "text-good")}>{pct}%</span>
          </div>
          <Progress value={pct} color={subject.color} />
        </div>
      </header>

      <div className="no-print -mx-4 mb-6 overflow-x-auto px-4 md:mx-0 md:px-0">
        <Tabs
          label="Subject sections"
          value={tab}
          onChange={setTab}
          options={TABS.map((t) => ({ value: t.key, label: t.label }))}
          className="min-w-max"
        />
      </div>

      <Active subject={subject} units={units} topics={topics} mode={mode} />
    </div>
  );
}
