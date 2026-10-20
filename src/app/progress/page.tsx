"use client";

import { format } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { BookOpen, Clock, Flame, Layers } from "lucide-react";
import { useState } from "react";
import { CoverageChart, MinutesChart, QuizTrendChart } from "@/components/progress/charts";
import { StatTile } from "@/components/progress/stat-tile";
import { Card, Empty, List, PageHeader, Select } from "@/components/ui";
import { addDay, fromDay, today } from "@/lib/dates";
import { db } from "@/lib/db";
import { coverage, fmtMins } from "@/lib/stats";

/** Consecutive days (ending today, or yesterday if today has nothing yet) with completed study. */
function streak(days: Set<string>) {
  let d = today();
  if (!days.has(d)) d = addDay(d, -1);
  let n = 0;
  while (days.has(d)) {
    n++;
    d = addDay(d, -1);
  }
  return n;
}

const link = "font-medium text-text underline underline-offset-2";

export default function ProgressPage() {
  const [quizSubject, setQuizSubject] = useState<number | "all">("all");
  const t = today();
  const data = useLiveQuery(async () => {
    const [subjects, topics, sessions, quizzes, cardsDue] = await Promise.all([
      db.subjects.toArray(),
      db.topics.toArray(),
      db.sessions.filter((s) => s.done).toArray(),
      db.quizzes.orderBy("createdAt").toArray(),
      db.flashcards.where("due").belowOrEqual(t).count(),
    ]);
    return { subjects, topics, sessions, quizzes, cardsDue };
  }, [t]);

  if (!data) return <PageHeader title="Progress" sub="Loading…" />;
  const { subjects, topics, sessions, quizzes, cardsDue } = data;

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
  const revised = topics.filter((x) => x.status === "revised").length;

  const coverageData = subjects.map((s) => ({ name: s.name, value: coverage(topics.filter((x) => x.subjectId === s.id)) }));

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

  const weak = topics.filter((x) => x.weak);
  const subjectName = new Map(subjects.map((s) => [s.id!, s]));
  const days = streak(studyDays);

  return (
    <>
      <PageHeader title="Progress" sub="How your preparation is going" />
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile tone="indigo" icon={<Clock />} label="Time studied" value={fmtMins(totalMins)} sub={`over ${studyDays.size} day${studyDays.size === 1 ? "" : "s"}`} />
          <StatTile tone="emerald" icon={<Flame />} label="Day streak" value={days} sub={days === 1 ? "day in a row" : "days in a row"} />
          <StatTile tone="violet" icon={<BookOpen />} label="Topics revised" value={`${revised}/${topics.length}`} sub={`${topics.filter((x) => x.status === "studied").length} studied, not yet revised`} />
          <StatTile
            tone="amber"
            icon={<Layers />}
            label="Cards due"
            value={cardsDue}
            sub={<Link href="/revise" className={link}>Review now</Link>}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Syllabus coverage">
            {topics.length ? <CoverageChart data={coverageData} /> : <Empty title="No topics yet">Add a syllabus to a subject.</Empty>}
            <p className="mt-1 text-xs text-muted">Studied topics count half. Revised topics count in full.</p>
          </Card>

          <Card title="Study minutes, last 14 days">
            {totalMins ? <MinutesChart data={minutesData} /> : <Empty title="No study logged yet">Mark sessions done in the Planner.</Empty>}
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
