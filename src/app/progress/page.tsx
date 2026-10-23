"use client";

import { format } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { AlertTriangle, BookOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { StatTile } from "@/components/progress/stat-tile";
import { Card, Empty, PageHeader, Section, Select } from "@/components/ui";
import { db, getSettings } from "@/lib/db";
import { topicsInScope } from "@/lib/mode";
import { coverage } from "@/lib/stats";

// recharts is large and only used here: it loads alongside the stats, and placeholders hold its space until it's in.
const chartSpace = () => <div className="h-60 w-full animate-pulse rounded-md bg-surface-2" />;

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

const link = "text-accent underline underline-offset-2";

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
  const coverageData = withSyllabus.map((s) => ({ name: s.name, color: s.color, value: coverage(scoped.filter((x) => x.subjectId === s.id)) }));

  const quizData = quizzes
    .filter((q) => quizSubject === "all" || q.subjectId === quizSubject)
    .map((q, i) => ({
      label: `#${i + 1}`,
      full: `${subjects.find((s) => s.id === q.subjectId)?.name ?? "Quiz"}, ${format(q.createdAt, "d MMM, HH:mm")}`,
      value: Math.round(q.score),
    }));

  const weak = scoped.filter((x) => x.weak);
  const subjectName = new Map(subjects.map((s) => [s.id!, s]));
  const seasonName = mode === "mid-term" ? "mid-sem" : "major";

  return (
    <>
      <PageHeader title="Progress" sub="How your preparation is going" />
      <div className="space-y-8">
        <div className="grid grid-cols-2 gap-4">
          <StatTile tone="accent" icon={<BookOpen />} label="Topics revised" value={`${revised}/${scoped.length}`} sub={`${scoped.filter((x) => x.status === "studied").length} studied, not yet revised`} />
          <StatTile
            tone="warn"
            icon={<AlertTriangle />}
            label="Weak topics"
            value={weak.length}
            sub="quiz scores under 60%"
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Syllabus coverage">
            {scoped.length ? (charts ? <charts.CoverageChart data={coverageData} /> : chartSpace()) : <Empty title="No topics yet">Add {mode ? "this exam's" : "a"} syllabus to a subject.</Empty>}
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
            {quizData.length ? (charts ? <charts.QuizTrendChart data={quizData} /> : chartSpace()) : <Empty title="No quizzes taken">Take a practice quiz from a subject&apos;s Quiz tab.</Empty>}
          </Card>
        </div>

        <Section title="Weak topics" action={weak.length > 0 && <span className="text-[13px] tabular-nums text-muted">{weak.length}</span>}>
          {weak.length ? (
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="flex items-center gap-3 border-b border-border bg-surface-2 px-4 py-2 text-[12px] font-medium text-muted">
                <span aria-hidden className="w-[3px] shrink-0" />
                <span className="flex-1">Topic</span>
                <span className="hidden w-40 sm:block">Subject</span>
                <span className="w-20 text-right">Confidence</span>
              </div>
              <ul className="divide-y divide-border">
                {weak.map((x) => {
                  const s = subjectName.get(x.subjectId);
                  return (
                    <li key={x.id} className="flex items-center gap-3 px-4 py-3 text-sm transition-colors duration-150 hover:bg-surface-2">
                      <span aria-hidden className="h-5 w-[3px] shrink-0 rounded-full" style={{ background: s?.color }} />
                      <div className="min-w-0 flex-1">
                        <Link href={`/subjects/view?id=${x.subjectId}`} className="block truncate font-medium text-text hover:text-accent hover:underline">{x.title}</Link>
                        <p className="truncate text-[13px] text-muted sm:hidden">{s?.name}</p>
                      </div>
                      <span className="hidden w-40 truncate text-[13px] text-muted sm:block">{s?.name}</span>
                      <span className="w-20 shrink-0 text-right text-[13px] tabular-nums text-muted">{x.confidence}/5</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted">No weak topics flagged. Low confidence or quiz scores under 60% show up here.</p>
          )}
        </Section>
      </div>
    </>
  );
}
