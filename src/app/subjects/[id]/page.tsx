"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { coverage } from "@/lib/stats";
import { Empty, Progress, cn } from "@/components/ui";
import { SyllabusTab } from "@/components/subject/syllabus-tab";
import { MaterialsTab } from "@/components/subject/materials-tab";
import { NotesTab } from "@/components/subject/notes-tab";
import { FlashcardsTab } from "@/components/subject/flashcards-tab";
import { QuizTab } from "@/components/subject/quiz-tab";
import { PredictTab } from "@/components/subject/predict-tab";
import { ChatTab } from "@/components/subject/chat-tab";

const TABS = [
  { key: "syllabus", label: "Syllabus", C: SyllabusTab },
  { key: "materials", label: "Materials", C: MaterialsTab },
  { key: "notes", label: "Notes", C: NotesTab },
  { key: "flashcards", label: "Flashcards", C: FlashcardsTab },
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
  const units = useLiveQuery(() => (valid ? db.units.where({ subjectId }).sortBy("order") : []), [subjectId, valid]) ?? [];
  const topics = useLiveQuery(() => (valid ? db.topics.where({ subjectId }).toArray() : []), [subjectId, valid]) ?? [];

  if (subject === undefined) return <p className="text-sm text-muted">Loading…</p>;
  if (!subject) return <Empty title="Subject not found"><Link href="/subjects" className="underline">Back to subjects</Link></Empty>;

  const pct = coverage(topics);
  const Active = TABS.find((t) => t.key === tab)!.C;

  return (
    <div>
      <Link href="/subjects" className="no-print mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft size={14} /> Subjects
      </Link>
      <header className="no-print mb-6 flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-baseline gap-3 text-[28px] font-semibold leading-tight tracking-tight [font-stretch:90%] md:text-[34px]">
            <span className="h-3 w-3 shrink-0 -translate-y-0.5 rounded-full" style={{ background: subject.color }} />
            <span className="min-w-0 break-words">{subject.name}</span>
          </h1>
          <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-muted">
            {subject.code && <span>{subject.code}</span>}
            {subject.credits ? <span>{subject.credits} credits</span> : null}
            <span>{topics.length} topics</span>
          </p>
        </div>
        <div className="w-full sm:w-44">
          <div className="mb-1.5 flex justify-between text-xs text-muted"><span>Covered</span><span className="tabular-nums">{pct}%</span></div>
          <Progress value={pct} color={subject.color} />
        </div>
      </header>

      <div className="no-print -mx-4 mb-6 overflow-x-auto border-b border-border px-4 md:mx-0 md:px-0">
        <div className="flex min-w-max gap-5" role="tablist" aria-label="Subject sections">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "-mb-px border-b-2 py-2.5 text-sm whitespace-nowrap transition-colors",
                tab === t.key ? "border-text font-semibold text-text" : "border-transparent text-muted hover:text-text",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <Active subject={subject} units={units} topics={topics} />
    </div>
  );
}
