"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ExternalLink, Flame, Loader2, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { db } from "@/lib/db";
import { modeShort, pyqMode, topicsInScope, unitInScope } from "@/lib/mode";
import { analyseSubject, remapSubject, retryPapers, setPaperExam, usePaperFailures, usePyqAnalysis } from "@/lib/pyq/analyse";
import {
  groupByTopic, groupByYear, needsMapping, paperYear, papersForMode, questionsOf, searchQuestions, unknownExamPapers, type TopicStat,
} from "@/lib/pyq/group";
import type { Material, PyqQuestion, Topic, Unit } from "@/lib/types";
import { QuestionLine } from "../pyq-question-line";
import { Badge, Button, Card, Empty, Input, List, Panel, Section, Segmented, cn } from "../ui";
import { isDriveUrl, OfflineHint, useOnline, type TabProps } from "./shared";

type View = "year" | "topic";

// Stable fallbacks while loading, so memoised groupings don't recompute every render.
const NO_QUESTIONS: PyqQuestion[] = [];
const NO_UNITS: Unit[] = [];
const NO_TOPICS: Topic[] = [];

export function PyqsTab({ subject, mode }: TabProps) {
  const subjectId = subject.id!;
  const online = useOnline();
  const analysis = usePyqAnalysis();
  const [view, setView] = useState<View>("year");
  const [query, setQuery] = useState("");

  const papers = useLiveQuery(() => db.materials.where({ subjectId }).filter((m) => m.kind === "pyq").toArray(), [subjectId]);
  const questions = useLiveQuery(() => db.pyqQuestions.where({ subjectId }).toArray(), [subjectId]) ?? NO_QUESTIONS;
  const allUnits = useLiveQuery(() => db.units.where({ subjectId }).sortBy("order"), [subjectId]) ?? NO_UNITS;
  const allTopics = useLiveQuery(() => db.topics.where({ subjectId }).toArray(), [subjectId]) ?? NO_TOPICS;

  // Strict split: only this exam's papers, questions and syllabus. Unknown papers go in their own card.
  const scoped = useMemo(() => papersForMode(papers ?? [], mode), [papers, mode]);
  const unknown = useMemo(() => unknownExamPapers(papers ?? []), [papers]);
  const modeQuestions = useMemo(() => questionsOf(questions, scoped), [questions, scoped]);
  const modeUnits = useMemo(() => allUnits.filter((u) => unitInScope(u, mode)), [allUnits, mode]);
  const modeTopics = useMemo(() => topicsInScope(allTopics, allUnits, mode), [allTopics, allUnits, mode]);
  const shown = useMemo(() => searchQuestions(modeQuestions, query), [modeQuestions, query]);
  // Years covered: by every paper of this exam (read or not), or by the matches while searching.
  const years = new Set((query.trim() ? shown.map((q) => q.year) : scoped.map(paperYear)).filter(Boolean));
  const topicById = useMemo(() => new Map(allTopics.map((t) => [t.id!, t])), [allTopics]);

  // Papers the AI couldn't read this session aren't "waiting": they're shown as failed with a Retry.
  const failures = usePaperFailures();
  const failedIds = (papers ?? []).filter((p) => !p.analysedAt && failures.has(p.id!)).map((p) => p.id!);
  const pending = (papers?.filter((p) => !p.analysedAt).length ?? 0) - failedIds.length;
  const topicIds = useMemo(() => new Set(modeTopics.map((t) => t.id)), [modeTopics]);
  const canMap = modeTopics.length > 0 && modeQuestions.some((q) => needsMapping(q, topicIds));

  // Start on our own when there's work and we're online. `pending` and `canMap` change as a run goes, so this
  // fires during the run it started: `ifIdle` makes those calls no-ops instead of queuing more AI work.
  useEffect(() => {
    if (online && (pending > 0 || canMap)) analyseSubject(subjectId, { ifIdle: true });
  }, [subjectId, online, pending, canMap]);

  if (!papers) return null;
  if (!papers.length) {
    return (
      <Empty title="No past papers yet">
        Past papers come in from your Google Drive folders automatically (Settings → Google Drive → Sync now). You can also upload them in
        Materials as &ldquo;Previous year paper&rdquo;. Each one is then split into questions and sorted by year and by topic.
      </Empty>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[17px] font-semibold tabular-nums">
              <span>{scoped.length} {modeShort(mode).toLowerCase()} paper{scoped.length === 1 ? "" : "s"}</span>
              <span>{shown.length} question{shown.length === 1 ? "" : "s"}</span>
              {years.size > 0 && <span className="font-normal text-muted">{years.size} year{years.size === 1 ? "" : "s"}</span>}
            </p>
            <p className="mt-1 text-[13px] text-muted" role="status">
              {analysis.running ? (
                <span className="inline-flex items-center gap-1.5 tabular-nums text-accent">
                  <Loader2 size={14} className={spin} aria-hidden /> {analysis.message}
                  {analysis.total > 1 && ` (${analysis.done}/${analysis.total})`}
                </span>
              ) : pending ? (
                `${pending} paper${pending === 1 ? "" : "s"} waiting to be split into questions.`
              ) : failedIds.length ? (
                <span className="text-bad">{failedIds.length} paper{failedIds.length === 1 ? "" : "s"} couldn&apos;t be read. Retry, or check the file in Materials.</span>
              ) : analysis.message ? (
                analysis.message
              ) : (
                "All papers analysed."
              )}
            </p>
          </div>
          {(pending > 0 || canMap) ? (
            // While the analyser runs the button says so, rather than only greying out.
            <Button onClick={() => analyseSubject(subjectId)} disabled={!online || analysis.running}>
              {analysis.running ? <><Loader2 size={16} className={spin} aria-hidden /> Analysing…</> : <><Sparkles size={16} /> Analyse now</>}
            </Button>
          ) : failedIds.length > 0 && (
            <Button variant="secondary" onClick={() => retryPapers(subjectId, failedIds)} disabled={!online || analysis.running}>
              {analysis.running ? <Loader2 size={16} className={spin} aria-hidden /> : <RefreshCw size={16} />} Retry {failedIds.length === 1 ? "paper" : `${failedIds.length} papers`}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <Segmented label="Sort questions" value={view} onChange={setView} options={[{ value: "year", label: "Year-wise" }, { value: "topic", label: "Topic-wise" }]} />
          <div className="relative min-w-0 flex-1 basis-48 sm:max-w-sm">
            <Search size={15} className={cn("pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 transition-colors duration-150", query ? "text-accent" : "text-muted")} aria-hidden />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // Escape empties the box, as in the search palette; the browser's own clear cross is swapped for ours.
              onKeyDown={(e) => { if (e.key === "Escape" && query) { e.preventDefault(); setQuery(""); } }}
              placeholder="Search questions"
              className="appearance-none pl-9 pr-9 [&::-webkit-search-cancel-button]:hidden"
              aria-label="Search questions"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                title="Clear search"
                className="press absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text pointer-coarse:before:absolute pointer-coarse:before:-inset-2 pointer-coarse:before:content-['']"
              >
                <X size={14} aria-hidden />
              </button>
            )}
          </div>
        </div>
        <div className="empty:hidden"><OfflineHint online={online} /></div>
      </div>

      {!scoped.length ? (
        <Empty title={`No ${modeShort(mode).toLowerCase()} papers yet`}>
          {unknown.length
            ? "Some papers don't say which exam they were for. Sort them below and they'll show up in the right exam."
            : `Only ${modeShort(mode).toLowerCase()} papers are shown here. Switch the exam mode to see the others.`}
        </Empty>
      ) : query.trim() && !shown.length ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-6 text-sm text-muted">
          <p className="min-w-0 break-words">No questions match &ldquo;{query.trim()}&rdquo;.</p>
          <Button variant="secondary" size="sm" onClick={() => setQuery("")}>Clear search</Button>
        </div>
      ) : (
        // Keyed by the view, so switching Year-wise / Topic-wise visibly settles the new list in rather than swapping in place.
        <div key={view} className="tab-in">
          {view === "year" ? (
            <YearView papers={scoped} questions={shown} topicById={topicById} searching={!!query.trim()} />
          ) : (
            <TopicView
              questions={shown}
              units={modeUnits}
              topics={modeTopics}
              papers={scoped}
              searching={!!query.trim()}
              onRemap={() => remapSubject(subjectId)}
              remapDisabled={!online || analysis.running || !modeTopics.length}
              remapping={analysis.running}
            />
          )}
        </div>
      )}

      {unknown.length > 0 && <UnknownExamPapers papers={unknown} />}
    </div>
  );
}

/** Papers nothing says the exam of: kept out of both modes until the student marks them. */
function UnknownExamPapers({ papers }: { papers: Material[] }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<{ id: number; exam: "mid-term" | "end-term" } | null>(null);
  const mark = async (id: number, exam: "mid-term" | "end-term") => {
    setBusy({ id, exam });
    try {
      await setPaperExam(id, exam);
    } finally {
      setBusy(null);
    }
  };
  const markButton = (p: Material, exam: "mid-term" | "end-term", label: string) => (
    <Button size="sm" variant="secondary" disabled={busy?.id === p.id} onClick={() => mark(p.id!, exam)}>
      {busy && busy.id === p.id && busy.exam === exam && <Loader2 size={14} className={spin} aria-hidden />}
      {label}
    </Button>
  );
  return (
    <Card
      title={
        // The whole heading line toggles, with a hover wash, so it reads as the control it is.
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="group -mx-2 -my-1 flex items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors duration-150 hover:bg-surface-2 pointer-coarse:py-2"
        >
          Exam type unknown <Badge tone="warn">{papers.length}</Badge>
          <ChevronDown size={16} className={cn("text-muted transition-transform duration-200 ease-snappy group-hover:text-text", open && "rotate-180")} aria-hidden />
        </button>
      }
    >
      {!open ? (
        <p className="text-sm leading-relaxed text-muted">These papers don&apos;t say whether they were a mid-sem or a major, so they&apos;re hidden from both. Open to sort them.</p>
      ) : (
        <List className="tab-in border-b-0">
          {papers.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 py-3">
              <div className="min-w-0 flex-1 basis-48">
                <p className="break-words text-[15px] font-medium [overflow-wrap:anywhere]">{p.fileName}</p>
                <p className="mt-1 flex flex-wrap gap-1.5">
                  <Badge>{paperYear(p) ?? "Year unknown"}</Badge>
                  {!p.analysedAt && <Badge>Not analysed yet</Badge>}
                </p>
              </div>
              {p.source && <DriveLink url={p.source.url} />}
              {markButton(p, "end-term", "Mark as Major")}
              {markButton(p, "mid-term", "Mark as Mid-sem")}
            </li>
          ))}
        </List>
      )}
    </Card>
  );
}

const DriveLink = ({ url }: { url: string }) => isDriveUrl(url) && (
  <a
    href={url}
    target="_blank"
    rel="noopener noreferrer"
    aria-label="Open in Google Drive"
    title="Open in Google Drive"
    className="press relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-3 hover:text-text pointer-coarse:before:absolute pointer-coarse:before:-inset-1 pointer-coarse:before:content-['']"
  >
    <ExternalLink size={14} aria-hidden />
  </a>
);

/** A spinner that answers a press; under reduced motion it holds still instead of flickering through 1ms turns. */
const spin = "animate-spin motion-reduce:animate-none";

const examBadge = (p: Pick<Material, "pyqExam" | "fileName">) => {
  const e = pyqMode(p);
  return e ? <Badge tone="accent">{modeShort(e)}</Badge> : <Badge tone="warn">Exam type unknown</Badge>;
};

function YearView({ papers, questions, topicById, searching }: {
  papers: Material[];
  questions: PyqQuestion[];
  topicById: Map<number, Topic>;
  searching: boolean;
}) {
  const groups = groupByYear(papers, questions);
  const failures = usePaperFailures();
  const online = useOnline();
  const analysis = usePyqAnalysis();
  return (
    <div className="space-y-10">
      {groups.map((g) => {
        // While searching, hide papers with no matching questions.
        const ps = searching ? g.papers.filter((p) => p.questions.length) : g.papers;
        if (!ps.length) return null;
        return (
          <section key={g.year ?? "unknown"}>
            <h2 className={cn("mb-4", g.year ? "numeral text-[28px]" : "text-[15px] font-semibold")}>{g.year ?? "Year unknown"}</h2>
            <div className="space-y-5">
              {ps.map(({ paper, questions: qs }) => (
                <Panel key={paper.id}>
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 border-b border-border bg-surface-2/60 px-4 py-3 sm:px-5">
                    <div className="min-w-0 flex-1 basis-48">
                      <h3 className="break-words text-[15px] font-semibold">{paper.fileName}</h3>
                      {paper.analysedAt && qs.length > 0 && (
                        <p className="mt-1.5 flex flex-wrap gap-1.5">
                          <Badge>{qs.length} question{qs.length === 1 ? "" : "s"}</Badge>
                          {marksOf(qs) ? <Badge>{marksOf(qs)} marks</Badge> : null}
                        </p>
                      )}
                    </div>
                    <div className="-my-0.5 flex shrink-0 items-center gap-1.5">
                      {examBadge(paper)}
                      {paper.source && <DriveLink url={paper.source.url} />}
                    </div>
                  </div>
                  {!paper.analysedAt && failures.has(paper.id!) ? (
                    <div className="p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bad/25 bg-bad/5 px-4 py-3">
                        <p className="min-w-0 text-sm text-bad">
                          Couldn&apos;t read this paper. <span className="text-muted">{failures.get(paper.id!)}</span>
                        </p>
                        <Button size="sm" variant="secondary" onClick={() => retryPapers(paper.subjectId, [paper.id!])} disabled={!online || analysis.running}>
                          <RefreshCw size={14} aria-hidden className={cn(analysis.running && spin)} /> Retry
                        </Button>
                      </div>
                    </div>
                  ) : !paper.analysedAt ? (
                    <p className="px-4 py-3 text-sm text-muted">Waiting to be split into questions.</p>
                  ) : !qs.length ? (
                    <p className="px-4 py-3 text-sm text-muted">{searching ? "No matching questions." : "No questions were found in this paper."}</p>
                  ) : (
                    <ul className="divide-y divide-border [&>li]:px-4 sm:[&>li]:px-5">
                      {qs.map((q) => (
                        <QuestionLine key={q.id} q={q} showYear={false} topic={q.topicId ? topicById.get(q.topicId) : undefined} />
                      ))}
                    </ul>
                  )}
                </Panel>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

const marksOf = (qs: PyqQuestion[]) => qs.reduce((a, q) => a + (q.marks ?? 0), 0);

function TopicView({ questions, units, topics, papers, searching, onRemap, remapDisabled, remapping }: {
  questions: PyqQuestion[];
  units: Unit[];
  topics: Topic[];
  papers: Material[];
  searching: boolean;
  onRemap: () => void;
  remapDisabled: boolean;
  remapping: boolean;
}) {
  const g = groupByTopic(questions, units, topics);
  const paperName = new Map(papers.map((p) => [p.id!, p.fileName]));
  const [showAllUnmatched, setShowAllUnmatched] = useState(false);
  const remap = (
    <Button variant="secondary" size="sm" onClick={onRemap} disabled={remapDisabled}>
      <RefreshCw size={14} aria-hidden className={cn(remapping && spin)} /> {remapping ? "Matching…" : "Re-match to syllabus"}
    </Button>
  );

  if (!topics.length) {
    return (
      <Empty title="Add the syllabus to sort by topic">
        Questions are matched to your syllabus topics. Add this year&apos;s syllabus in the Syllabus tab, then come back. Matching starts on its own.
      </Empty>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex justify-end">{remap}</div>

      {g.units.map(({ unit, topics: stats }) => (
        <Section key={unit.id} title={unit.title}>
          <Panel as="ul" className="divide-y divide-border">
            {stats.map((s) => <TopicRow key={s.topic.id} stat={s} paperName={paperName} />)}
          </Panel>
        </Section>
      ))}

      {g.unmatched.length > 0 && (
        <Section title={<span className="flex items-center gap-2">Not matched yet <Badge>{g.unmatched.length}</Badge></span>}>
          <p className="mb-3 max-w-prose text-sm leading-relaxed text-muted">These are matched to topics automatically. If this exam&apos;s syllabus isn&apos;t added yet, add it in the Syllabus tab.</p>
          <Panel as="ul" className="divide-y divide-border [&>li]:px-4 sm:[&>li]:px-5">
            {(showAllUnmatched ? g.unmatched : g.unmatched.slice(0, 50)).map((q) => <QuestionLine key={q.id} q={q} paperName={paperName.get(q.materialId)} />)}
          </Panel>
          {g.unmatched.length > 50 && (
            <div className="mt-3 flex items-center justify-between gap-2 text-[13px] tabular-nums text-muted">
              <span>Showing {showAllUnmatched ? g.unmatched.length : 50} of {g.unmatched.length}</span>
              <Button size="sm" variant="secondary" onClick={() => setShowAllUnmatched((v) => !v)}>
                {showAllUnmatched ? "Show fewer" : "Show all"}
              </Button>
            </div>
          )}
        </Section>
      )}

      {g.notInSyllabus.length > 0 && (
        <Section title={<span className="flex items-center gap-2">Not in this year&apos;s syllabus <Badge>{g.notInSyllabus.length}</Badge></span>}>
          <Panel as="ul" className="divide-y divide-border [&>li]:px-4 sm:[&>li]:px-5">
            {g.notInSyllabus.map((q) => <QuestionLine key={q.id} q={q} paperName={paperName.get(q.materialId)} />)}
          </Panel>
        </Section>
      )}

      {/* While searching, every topic without a hit would look "never asked". */}
      {!searching && g.neverAsked.length > 0 && (
        <p className="max-w-prose text-sm leading-relaxed text-muted">
          <span className="font-medium text-text">Never asked so far:</span> {g.neverAsked.map((t) => t.title).join(", ")}.
        </p>
      )}
    </div>
  );
}

function TopicRow({ stat, paperName }: { stat: TopicStat; paperName: Map<number, string> }) {
  const [open, setOpen] = useState(false);
  const { topic, count, years, marks, hot, questions } = stat;
  return (
    // An open topic keeps a faint wash under its heading and its questions, so they read as one block.
    <li className={cn("transition-colors duration-200 ease-snappy", open && "bg-surface-2/50")}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        // The ring sits inside the row: the Panel's rounded clip would cut an outside one off.
        className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:-outline-offset-2 sm:px-5"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-medium">
            <span className="min-w-0 break-words">{topic.title}</span>
            {hot && <Badge tone="warn"><Flame aria-hidden />Most asked</Badge>}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] tabular-nums text-muted empty:hidden">
            {years && <Badge>{years[0] === years[1] ? years[0] : `${years[0]}–${years[1]}`}</Badge>}
            {marks ? <Badge>{marks} marks</Badge> : null}
          </span>
        </span>
        <Badge tone={hot ? "accent" : "neutral"} className="shrink-0">Asked {count}×</Badge>
        <ChevronDown size={16} aria-hidden className={cn("shrink-0 text-muted transition-[transform,color] duration-200 ease-snappy group-hover:text-text", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="tab-in mx-4 divide-y divide-border border-t border-border sm:mx-5">
          {questions.map((q) => <QuestionLine key={q.id} q={q} paperName={paperName.get(q.materialId)} />)}
        </ul>
      )}
    </li>
  );
}
