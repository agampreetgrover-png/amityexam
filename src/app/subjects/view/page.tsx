"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { Suspense, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { modeShort, topicsInScope, unitInScope, useExamMode } from "@/lib/mode";
import { coverage } from "@/lib/stats";
import { Empty, Progress, Tabs, subjectStyle } from "@/components/ui";
import { SyllabusTab } from "@/components/subject/syllabus-tab";
import { MaterialsTab } from "@/components/subject/materials-tab";
import { PyqsTab } from "@/components/subject/pyqs-tab";
import { NotesTab } from "@/components/subject/notes-tab";
import { QuizTab } from "@/components/subject/quiz-tab";
import { PredictTab } from "@/components/subject/predict-tab";
import { ChatTab } from "@/components/subject/chat-tab";

const TABS = [
  { key: "syllabus", label: "Syllabus", C: SyllabusTab },
  { key: "materials", label: "Materials", C: MaterialsTab },
  { key: "pyqs", label: "PYQs", C: PyqsTab },
  { key: "notes", label: "Notes", C: NotesTab },
  { key: "quiz", label: "Quiz", C: QuizTab },
  { key: "predict", label: "Predict", C: PredictTab },
  { key: "chat", label: "Ask", C: ChatTab },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function SubjectPage() {
  // The id is a query param, not a path segment, so this one prerendered (and precached) page serves every subject,
  // offline too. Ids only exist in IndexedDB, so the server could never build a page per subject.
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <SubjectFromUrl />
    </Suspense>
  );
}

function SubjectFromUrl() {
  const id = useSearchParams().get("id");
  // Keyed so opening another subject starts fresh, as a separate page would.
  return <Subject key={id} subjectId={id ? Number(id) : NaN} />;
}

function Subject({ subjectId }: { subjectId: number }) {
  const [tab, setTabState] = useState<TabKey>("syllabus");
  // Tabs stay mounted once opened, so leaving a half-done quiz or a half-typed question and coming back keeps it.
  const [visited, setVisited] = useState<Set<TabKey>>(() => new Set<TabKey>(["syllabus"]));
  const open = (key: TabKey) => {
    setTabState(key);
    setVisited((v) => (v.has(key) ? v : new Set(v).add(key)));
  };
  // The tab lives in ?tab= so a refresh lands on the same section. Read after mount so server and client agree.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    const match = TABS.find((t) => t.key === fromUrl);
    if (match) {
      setTabState(match.key);
      setVisited((v) => new Set(v).add(match.key));
    }
  }, []);
  const setTab = (key: TabKey) => {
    open(key);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", key);
    // A string, not the URL object: Serwist's cache-on-navigation hook posts this argument to a worker, and URLs can't be cloned.
    window.history.replaceState(window.history.state, "", url.href);
  };

  const valid = Number.isInteger(subjectId);

  // null = not found; undefined = still loading. A bad id (e.g. ?id=abc) is treated as not found
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

  return (
    <div>
      <Link href="/subjects" className="no-print mb-4 inline-flex items-center gap-1 rounded-md text-sm font-medium text-muted transition-colors duration-150 hover:text-text">
        <ArrowLeft size={14} /> Subjects
      </Link>
      <header style={subjectStyle(subject.color)} className="subj-tint subj-edge-thick no-print mb-6 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 rounded-lg py-5 pl-7 pr-5 sm:pl-8">
        <div className="min-w-0 flex-1">
          <h1 className="subj-ink break-words font-display text-[28px] leading-tight md:text-[32px]">{subject.name}</h1>
          <p className="mt-1 flex flex-wrap gap-x-3 text-[15px] text-muted">
            {subject.code && <span>{subject.code}</span>}
            {subject.credits ? <span>{subject.credits} credits</span> : null}
            <span>{topics.length} {modeShort(mode).toLowerCase()} topic{topics.length === 1 ? "" : "s"}</span>
          </p>
        </div>
        <div className="w-full sm:w-52">
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className="text-[13px] text-muted">Syllabus covered</span>
            <span className="text-sm font-semibold tabular-nums">{pct}%</span>
          </div>
          <Progress value={pct} color={subject.color} className="bg-surface/90" />
        </div>
      </header>

      {/* Scrolls sideways on phones instead of wrapping the tab row. The vertical padding keeps focus rings from being clipped by the scroller. */}
      <div className="no-print -mx-4 mb-5 overflow-x-auto px-4 py-1 md:mx-0 md:px-0">
        <Tabs
          label="Subject sections"
          value={tab}
          onChange={setTab}
          options={TABS.map((t) => ({ value: t.key, label: t.label }))}
          className="min-w-max"
        />
      </div>

      {/* Keyed so a mode switch (or another subject) starts each tab fresh instead of keeping a half-built quiz on the old syllabus.
          Opened tabs stay mounted and are only hidden, so switching tabs never throws work away. */}
      {TABS.filter((t) => visited.has(t.key)).map(({ key, C }) => (
        <div key={`${subject.id}-${mode}-${key}`} hidden={key !== tab}>
          {/* The Syllabus tab gets every unit so new ones are numbered after all of them; it lists only this mode's part, like the rest. */}
          <C subject={subject} units={key === "syllabus" ? allUnits : units} topics={key === "syllabus" ? allTopics : topics} mode={mode} />
        </div>
      ))}
    </div>
  );
}
