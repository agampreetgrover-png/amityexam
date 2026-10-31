"use client";

import { format } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { AlertTriangle, BookOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { StatTile } from "@/components/progress/stat-tile";
import { Card, Empty, PageHeader, Panel, Section, Select, cn, subjectStyle, tableHead } from "@/components/ui";
import { db, getSettings } from "@/lib/db";
import { topicsInScope } from "@/lib/mode";
import { coverage } from "@/lib/stats";

// recharts is large and only used here: it loads alongside the stats, and placeholders hold its space until it's in.
// h matches the chart's plot height; mb-9 holds the "Show as table" row each chart adds underneath.
const chartSpace = (h = 240) => <div style={{ height: h }} className="mb-9 w-full animate-pulse rounded-lg bg-surface-2" />;

type Charts = typeof import("@/components/progress/charts");
let loadedCharts: Charts | null = null; // kept for the session, so coming back to Progress draws the charts at once

/**
 * The charts module, loaded into state rather than through next/dynamic. dynamic() suspends, and React keeps a
 * Suspense fallback up for at least 300 ms once it's shown, so the charts appeared late on every visit.
 */
function useCharts() {
  const [charts, setCharts] = useState(loadedCharts);
  useEffect(() => {
    if (charts) return;
    let live = true;
    import("@/components/progress/charts").then(
      (m) => {
        loadedCharts = m;
        if (live) setCharts(m);
      },
      () => {}, // offline without the chunk cached: the placeholders stay
    );
    return () => {
      live = false;
    };
  }, [charts]);
  return charts;
}

const link = "font-medium text-accent underline underline-offset-2";

export default function ProgressPage() {
  const [quizSubject, setQuizSubject] = useState<number | "all">("all");
  const loaded = useCharts();
  // Units and the exam mode come in the same query, so the page draws once with everything rather than again as each arrives.
  const data = useLiveQuery(async () => {
    const [subjects, topics, units, quizzes, settings] = await Promise.all([
      db.subjects.toArray(),
      db.topics.toArray(),
      db.units.toArray(),
      db.quizzes.orderBy("createdAt").toArray(),
      getSettings(),
    ]);
    return { subjects, topics, units, quizzes, mode: settings.examMode };
  });
  // Charts draw in the task after the stats, so the numbers show first instead of waiting on recharts.
  const [statsShown, setStatsShown] = useState(false);
  useEffect(() => {
    if (data) setStatsShown(true);
  }, [data]);
  const charts = statsShown ? loaded : null;

  if (!data) return <PageHeader title="Progress" sub="Loading…" />;
  const { subjects, topics, units, quizzes, mode } = data;

  if (!subjects.length) {
    return (
      <>
        <PageHeader title="Progress" />
        <Empty title="Nothing to track yet">
          Add <Link href="/subjects" className={link}>subjects</Link> and start studying to see your progress.
        </Empty>
      </>
    );
  }

  // Coverage, revised counts and weak topics only count what this exam mode examines.
  const scoped = topicsInScope(topics, units, mode);
  const revised = scoped.filter((x) => x.status === "revised").length;

  // A subject with no syllabus in this mode would show a misleading 0%; it's listed under the chart instead.
  const withSyllabus = subjects.filter((s) => scoped.some((x) => x.subjectId === s.id));
  const withoutSyllabus = subjects.filter((s) => !scoped.some((x) => x.subjectId === s.id));
  const coverageData = withSyllabus
    .map((s) => ({ name: s.name, color: s.color, value: coverage(scoped.filter((x) => x.subjectId === s.id)) }))
    .sort((a, b) => a.value - b.value); // least-covered first: the chart answers "what needs work"

  const quizData = quizzes
    .filter((q) => quizSubject === "all" || q.subjectId === quizSubject)
    .map((q, i) => ({
      label: `#${i + 1}`,
      full: `${subjects.find((s) => s.id === q.subjectId)?.name ?? "Quiz"}, ${format(q.createdAt, "d MMM, HH:mm")}`,
      value: Math.round(q.score),
    }));

  const weak = scoped.filter((x) => x.weak);
  const subjectName = new Map(subjects.map((s) => [s.id!, s]));
  // The figure that flags a topic weak: its last 3 quiz scores, as refreshWeak averages them (quizzes are oldest first).
  const quizAvg = (id: number) => {
    const s = quizzes.filter((q) => q.topicIds.includes(id)).slice(-3).map((q) => q.score);
    return s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : null;
  };
  const seasonName = mode === "mid-term" ? "mid-sem" : "major";

  return (
    <>
      <PageHeader title="Progress" sub="How your preparation is going" />
      <div className="space-y-8">
        <div className="grid grid-cols-2 gap-4">
          <StatTile tone="accent" icon={<BookOpen />} label="Topics revised" value={<>{revised}<span className="text-[0.55em] tracking-normal text-muted">/{scoped.length}</span></>} sub={`${scoped.filter((x) => x.status === "studied").length} studied, not yet revised`} />
          <StatTile
            tone="warn"
            icon={<AlertTriangle />}
            label="Weak topics"
            value={weak.length}
            sub="quiz scores under 60%"
          />
        </div>

        <Section title="Weak topics" action={weak.length > 0 && <span className="text-[13px] tabular-nums text-muted">{weak.length}</span>}>
          {weak.length ? (
            <Panel>
              <div className={cn(tableHead, "flex items-center gap-3 px-4 py-2.5 sm:px-5")}>
                <span aria-hidden className="w-[3px] shrink-0" />
                <span className="flex-1">Topic</span>
                <span className="hidden w-40 sm:block">Subject</span>
                <span className="w-20 text-right">Quiz avg</span>
              </div>
              <ul className="divide-y divide-border">
                {weak.map((x) => {
                  const s = subjectName.get(x.subjectId);
                  const avg = quizAvg(x.id!);
                  return (
                    <li key={x.id} className="flex items-center gap-3 px-4 py-3 text-sm transition-colors duration-150 hover:bg-surface-2/60 sm:px-5">
                      <span aria-hidden className="subj-dot h-5 w-[3px] shrink-0 rounded-full" style={subjectStyle(s?.color)} />
                      <div className="min-w-0 flex-1">
                        <Link href={`/subjects/view?id=${x.subjectId}`} className="line-clamp-2 break-words font-medium text-text hover:text-accent hover:underline sm:block sm:truncate">{x.title}</Link>
                        <p className="truncate text-[13px] text-muted sm:hidden">{s?.name}</p>
                      </div>
                      <span className="hidden w-40 truncate text-[13px] text-muted sm:block">{s?.name}</span>
                      <span className="w-20 shrink-0 text-right text-[13px] tabular-nums text-muted">{avg == null ? "–" : `${avg}%`}</span>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ) : (
            <p className="text-sm text-muted">No weak topics flagged. Topics whose recent quiz average is under 60% show up here.</p>
          )}
        </Section>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Syllabus coverage">
            {scoped.length ? (charts ? <charts.CoverageChart data={coverageData} /> : chartSpace(Math.max(120, coverageData.length * 40 + 40))) : <Empty title="No topics yet">Add {mode ? "this exam's" : "a"} syllabus to a subject.</Empty>}
            <p className="mt-2 text-[13px] text-muted">
              {mode && `${mode === "mid-term" ? "Mid-sem" : "Major"} syllabus only. `}Studied topics count half. Revised topics count in full.
            </p>
            {scoped.length > 0 && withoutSyllabus.length > 0 && (
              <p className="mt-1 text-[13px] text-muted">No {seasonName} syllabus yet: {withoutSyllabus.map((s) => s.name).join(", ")}</p>
            )}
          </Card>

          <Card
            title="Quiz scores"
            action={
              <Select
                value={quizSubject}
                onChange={(e) => setQuizSubject(e.target.value === "all" ? "all" : Number(e.target.value))}
                className="h-8 w-40 py-0 text-[13px]"
                aria-label="Filter quizzes by subject"
              >
                <option value="all">All subjects</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            }
          >
            {quizData.length ? (charts ? <charts.QuizTrendChart data={quizData} connect={quizSubject !== "all"} /> : chartSpace()) : <Empty title="No quizzes taken">Take a practice quiz from a subject&apos;s Quiz tab.</Empty>}
          </Card>
        </div>
      </div>
    </>
  );
}
