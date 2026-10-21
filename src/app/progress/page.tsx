"use client";

import { format } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { AlertTriangle, BookOpen, Clock, Flame } from "lucide-react";
import { useState } from "react";
import dynamic from "next/dynamic";
import { StatTile } from "@/components/progress/stat-tile";
import { Card, Empty, List, PageHeader, Select } from "@/components/ui";
import { addDay, fromDay, today } from "@/lib/dates";
import { db, getSettings } from "@/lib/db";
import { topicsInScope, useExamMode } from "@/lib/mode";
import { coverage, fmtMins } from "@/lib/stats";

// recharts is large and only used here: load it after the stats so the page shows up first.
const chartSpace = () => <div className="h-60 w-full animate-pulse rounded-xl bg-surface-2" />;
const CoverageChart = dynamic(() => import("@/components/progress/charts").then((m) => m.CoverageChart), { ssr: false, loading: chartSpace });
const MinutesChart = dynamic(() => import("@/components/progress/charts").then((m) => m.MinutesChart), { ssr: false, loading: chartSpace });
const QuizTrendChart = dynamic(() => import("@/components/progress/charts").then((m) => m.QuizTrendChart), { ssr: false, loading: chartSpace });

/**
 * Study days in a row, ending today (or yesterday if today has nothing yet).
 * Planned days off and days with nothing scheduled don't break the streak; they're skipped.
 */
function streak(days: Set<string>, offDays: number[], plannedDays: Set<string>) {
  if (!days.size) return 0;
  const earliest = [...days].sort()[0];
  let d = today();
  if (!days.has(d)) d = addDay(d, -1);
  let n = 0;
  while (d >= earliest) {
    if (days.has(d)) n++;
    else if (!offDays.includes(fromDay(d).getDay()) && plannedDays.has(d)) break;
    d = addDay(d, -1);
  }
  return n;
}

const link = "font-medium text-text underline underline-offset-2";

export default function ProgressPage() {
  const [quizSubject, setQuizSubject] = useState<number | "all">("all");
  const t = today();
  const data = useLiveQuery(async () => {
    const [subjects, topics, allSessions, quizzes, settings] = await Promise.all([
      db.subjects.toArray(),
      db.topics.toArray(),
      db.sessions.toArray(),
      db.quizzes.orderBy("createdAt").toArray(),
      getSettings(),
    ]);
    const sessions = allSessions.filter((s) => s.done);
    const plannedDays = new Set(allSessions.map((s) => s.date));
    return { subjects, topics, sessions, quizzes, plannedDays, offDays: settings.offDays };
  });
  const mode = useExamMode();
  const units = useLiveQuery(() => db.units.toArray());

  if (!data || !units) return <PageHeader title="Progress" sub="Loading…" />;
  const { subjects, topics, sessions, quizzes } = data;

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

  const totalMins = sessions.reduce((a, s) => a + s.actualMins, 0);
  const studyDays = new Set(sessions.filter((s) => s.actualMins > 0).map((s) => s.date));
  // Coverage, revised counts and weak topics only count what this exam mode examines.
  const scoped = topicsInScope(topics, units, mode);
  const revised = scoped.filter((x) => x.status === "revised").length;

  // A subject with no syllabus in this mode would show a misleading 0%; it's listed under the chart instead.
  const withSyllabus = subjects.filter((s) => scoped.some((x) => x.subjectId === s.id));
  const withoutSyllabus = subjects.filter((s) => !scoped.some((x) => x.subjectId === s.id));
  const coverageData = withSyllabus.map((s) => ({ name: s.name, value: coverage(scoped.filter((x) => x.subjectId === s.id)) }));

  const minutesData = Array.from({ length: 14 }, (_, i) => {
    const d = addDay(t, i - 13);
    const value = sessions.filter((s) => s.date === d).reduce((a, s) => a + s.actualMins, 0);
    return { label: format(fromDay(d), "d MMM"), full: format(fromDay(d), "EEE, d MMM"), value };
  });

  const quizData = quizzes
    .filter((q) => quizSubject === "all" || q.subjectId === quizSubject)
    .map((q, i) => ({
      label: `#${i + 1}`,
      full: `${subjects.find((s) => s.id === q.subjectId)?.name ?? "Quiz"}, ${format(q.createdAt, "d MMM, HH:mm")}`,
      value: Math.round(q.score),
    }));

  const weak = scoped.filter((x) => x.weak);
  const subjectName = new Map(subjects.map((s) => [s.id!, s]));
  const days = streak(studyDays, data.offDays, data.plannedDays);
  const recentMins = minutesData.reduce((a, d) => a + d.value, 0);
  const seasonName = mode === "mid-term" ? "mid-sem" : "major";

  return (
    <>
      <PageHeader title="Progress" sub="How your preparation is going" />
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile tone="indigo" icon={<Clock />} label="Time studied" value={fmtMins(totalMins)} sub={`over ${studyDays.size} day${studyDays.size === 1 ? "" : "s"}`} />
          <StatTile tone="emerald" icon={<Flame />} label="Day streak" value={days} sub={days === 1 ? "day in a row" : "days in a row"} />
          <StatTile tone="violet" icon={<BookOpen />} label="Topics revised" value={`${revised}/${scoped.length}`} sub={`${scoped.filter((x) => x.status === "studied").length} studied, not yet revised`} />
          <StatTile
            tone="amber"
            icon={<AlertTriangle />}
            label="Weak topics"
            value={weak.length}
            sub={<Link href="/revise" className={link}>Revise now</Link>}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Syllabus coverage">
            {scoped.length ? <CoverageChart data={coverageData} /> : <Empty title="No topics yet">Add {mode ? "this exam's" : "a"} syllabus to a subject.</Empty>}
            <p className="mt-1 text-xs text-muted">
              {mode && `${mode === "mid-term" ? "Mid-sem" : "Major"} syllabus only. `}Studied topics count half. Revised topics count in full.
            </p>
            {scoped.length > 0 && withoutSyllabus.length > 0 && (
              <p className="mt-1 text-xs text-muted">No {seasonName} syllabus yet: {withoutSyllabus.map((s) => s.name).join(", ")}</p>
            )}
          </Card>

          <Card title="Study minutes, last 14 days">
            {recentMins ? (
              <MinutesChart data={minutesData} />
            ) : (
              <Empty title={totalMins ? "No study in the last 14 days" : "No study logged yet"}>Mark sessions done in the Planner.</Empty>
            )}
          </Card>
        </div>

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
          {quizData.length ? <QuizTrendChart data={quizData} /> : <Empty title="No quizzes taken">Take a practice quiz from a subject&apos;s Quiz tab.</Empty>}
        </Card>

        <Card title="Weak topics" action={weak.length > 0 && <span className="text-sm text-muted">{weak.length}</span>}>
          {weak.length ? (
            <List className="border-y-0">
              {weak.map((x) => {
                const s = subjectName.get(x.subjectId);
                return (
                  <li key={x.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <Link href={`/subjects/${x.subjectId}`} className="flex min-w-0 items-center gap-2 hover:underline">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s?.color }} />
                      <span className="truncate">{x.title}</span>
                    </Link>
                    <span className="shrink-0 text-xs text-muted">{s?.name}, confidence {x.confidence}/5</span>
                  </li>
                );
              })}
            </List>
          ) : (
            <p className="text-sm text-muted">No weak topics flagged. Low confidence or quiz scores under 60% show up here.</p>
          )}
        </Card>
      </div>
    </>
  );
}
