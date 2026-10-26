"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronDown, ExternalLink, Flame } from "lucide-react";
import { useMemo, useState } from "react";
import { db, getSettings } from "@/lib/db";
import { modeShort } from "@/lib/mode";
import { importantTopics, type ImportantTopic } from "@/lib/pyq/group";
import type { PyqQuestion } from "@/lib/types";
import { Badge, Button, Empty, PageHeader, Panel, Select, cn, subjectStyle, tableHead } from "@/components/ui";

const link = "text-accent underline underline-offset-2";
// Enough to open the page quickly on a big question bank; the rest is a tap away.
const FIRST_SHOWN = 60;

export default function ImportantTopicsPage() {
  const [subjectId, setSubjectId] = useState<number | "all">("all");
  const [showAll, setShowAll] = useState(false);

  // Everything in one query, so the ranking draws once rather than reshuffling as each table loads.
  const data = useLiveQuery(async () => {
    const [subjects, topics, questions, settings] = await Promise.all([
      db.subjects.orderBy("name").toArray(),
      db.topics.toArray(),
      db.pyqQuestions.toArray(),
      getSettings(),
    ]);
    return { subjects, topics, questions, mode: settings.examMode };
  });

  // Only this exam's questions count: a major prediction shouldn't be swayed by mid-sem papers, or the reverse.
  // (A question's exam tag is set from its paper when it's matched to a topic.)
  const ranked = useMemo(() => {
    if (!data) return [];
    const scoped = data.questions.filter((q) => q.exam === data.mode);
    return importantTopics(scoped, data.topics, data.subjects);
  }, [data]);

  if (!data || !data.mode) return <PageHeader title="Important topics" sub="Loading…" />;
  const { subjects, mode } = data;
  const seasonName = modeShort(mode).toLowerCase();

  if (!subjects.length) {
    return (
      <>
        <PageHeader title="Important topics" />
        <Empty icon={<Flame size={28} />} title="Nothing ranked yet">
          Add <Link href="/subjects" className={link}>subjects</Link>, then sync or upload past papers. Their questions are matched to your syllabus and the
          most-asked topics show up here.
        </Empty>
      </>
    );
  }

  // Which subjects actually have asked topics in this mode — the only ones worth offering in the filter.
  const withTopics = subjects.filter((s) => ranked.some((r) => r.subject.id === s.id));
  const rows = subjectId === "all" ? ranked : ranked.filter((r) => r.subject.id === subjectId);
  const shown = showAll ? rows : rows.slice(0, FIRST_SHOWN);
  const totalAsked = rows.reduce((a, r) => a + r.count, 0);

  return (
    <>
      <PageHeader
        title="Important topics"
        sub={`The topics asked most often in your ${seasonName} past papers`}
        action={
          withTopics.length > 1 && (
            <Select
              value={subjectId}
              onChange={(e) => {
                setSubjectId(e.target.value === "all" ? "all" : Number(e.target.value));
                setShowAll(false);
              }}
              className="h-9 w-44 text-[13px]"
              aria-label="Filter by subject"
            >
              <option value="all">All subjects</option>
              {withTopics.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )
        }
      />

      {!rows.length ? (
        <Empty icon={<Flame size={28} />} title={`No ranked ${seasonName} topics yet`}>
          Once your {seasonName} past papers are split into questions and matched to the syllabus, the most-asked topics appear here. Check a subject&apos;s{" "}
          <span className="font-medium text-text">PYQs</span> tab to see how the analysis is going, or switch the exam mode for the other season.
        </Empty>
      ) : (
        <div className="space-y-5">
          <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[15px] tabular-nums text-muted">
            <span><span className="font-semibold text-text">{rows.length}</span> topic{rows.length === 1 ? "" : "s"} asked</span>
            <span><span className="font-semibold text-text">{totalAsked}</span> question{totalAsked === 1 ? "" : "s"}</span>
            <span className="inline-flex items-center gap-1.5">
              <HotBadge /> asked most often
            </span>
          </p>

          <Panel>
            <div className={cn(tableHead, "hidden items-center gap-3 px-4 py-2.5 sm:flex sm:px-5")}>
              <span aria-hidden className="w-7 shrink-0" />
              <span className="flex-1">Topic</span>
              <span className="w-28 shrink-0">Years asked</span>
              <span className="w-24 shrink-0 text-right">Marks</span>
              <span className="w-20 shrink-0 text-right">Asked</span>
              <span aria-hidden className="w-5 shrink-0" />
            </div>
            <ul className="divide-y divide-border">
              {shown.map((r, i) => <Row key={r.topic.id} rank={i + 1} stat={r} showSubject={subjectId === "all"} />)}
            </ul>
          </Panel>

          {rows.length > FIRST_SHOWN && (
            <div className="flex items-center justify-between gap-2 text-[13px] tabular-nums text-muted">
              <span>Showing {shown.length} of {rows.length}</span>
              <Button size="sm" variant="secondary" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show fewer" : "Show all"}
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** Navy tag for the most-asked topics, matching the per-subject topic view. */
const HotBadge = () => <Badge className="bg-accent-soft text-accent">Hot</Badge>;

function Row({ rank, stat, showSubject }: { rank: number; stat: ImportantTopic; showSubject: boolean }) {
  const [open, setOpen] = useState(false);
  const { topic, subject, count, years, marks, hot, questions } = stat;
  const span = years ? (years[0] === years[1] ? `${years[0]}` : `${years[0]}–${years[1]}`) : "—";
  return (
    <li style={subjectStyle(subject.color)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-2/60 sm:px-5"
      >
        <span className="numeral w-7 shrink-0 text-[15px] text-muted">{rank}</span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-medium">
            <span className="min-w-0 break-words">{topic.title}</span>
            {hot && <HotBadge />}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] tabular-nums text-muted">
            {showSubject && (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: subject.color }} />
                {subject.name}
              </span>
            )}
            <span className="sm:hidden">{span}</span>
            {marks > 0 && <span className="sm:hidden">{marks} marks</span>}
          </p>
        </div>
        <span className="hidden w-28 shrink-0 text-[13px] tabular-nums text-muted sm:block">{span}</span>
        <span className="hidden w-24 shrink-0 text-right text-[13px] tabular-nums text-muted sm:block">{marks > 0 ? `${marks}` : "—"}</span>
        <span className="w-20 shrink-0 whitespace-nowrap text-right text-[13px] tabular-nums text-muted">
          <span className={cn("font-semibold", hot ? "text-accent" : "text-text")}>{count}×</span>
        </span>
        <ChevronDown size={16} className={cn("w-5 shrink-0 text-muted transition-transform duration-150", open && "rotate-180")} />
      </button>
      {open && (
        <div className="tab-in mx-4 mb-3 border-l-2 border-accent/30 pl-4 sm:mx-5">
          <ul className="divide-y divide-border">
            {questions.map((q) => <QuestionLine key={q.id} q={q} />)}
          </ul>
          <Link
            href={`/subjects/view?id=${subject.id}&tab=pyqs`}
            className="mt-2.5 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline"
          >
            Open in {subject.name} PYQs <ExternalLink size={13} />
          </Link>
        </div>
      )}
    </li>
  );
}

/** One past-paper question under an expanded topic: year, the question, marks. */
function QuestionLine({ q }: { q: PyqQuestion }) {
  return (
    <li className="flex gap-3 py-2.5">
      <span className="w-11 shrink-0 pt-0.5 text-[13px] font-medium tabular-nums text-muted">{q.year ?? "—"}</span>
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-line break-words text-[14px] leading-relaxed">{q.text}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[12px] tabular-nums text-muted empty:hidden">
          <span>{q.number}</span>
          {q.section && <span>{q.section}</span>}
        </p>
      </div>
      {q.marks ? <span className="shrink-0 whitespace-nowrap pt-0.5 text-right text-[13px] tabular-nums text-muted">{q.marks} marks</span> : null}
    </li>
  );
}
