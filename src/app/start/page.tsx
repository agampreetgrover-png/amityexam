"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Compass } from "lucide-react";
import { useState } from "react";
import { db, getSettings } from "@/lib/db";
import { daysBetween } from "@/lib/dates";
import { byWhen } from "@/lib/exams";
import { examInMode, topicsInScope } from "@/lib/mode";
import { crashPlan, formatMins, prepRows } from "@/lib/prep";
import { ratePrep, usePrepRun } from "@/lib/prep-run";
import { useToday } from "@/lib/use-today";
import { AiErrorBox } from "@/components/ai-error";
import { PrepTopicRow } from "@/components/prep-row";
import { Button, Empty, Input, PageHeader, Panel, Select, cn, tableHead } from "@/components/ui";

const link = "font-medium text-accent underline underline-offset-2";
const HOURS = [2, 3, 4, 5, 6, 8, 10];

/**
 * For a student who has studied nothing and has days, not weeks: one subject's topics, best value first (asked
 * most, weighed most, quickest, least groundwork), packed into the days left at the hours they can give. Worked
 * out on the spot from the Zero prep ratings and never saved.
 */
export default function StartHerePage() {
  const today = useToday();
  const run = usePrepRun();
  const [picked, setPicked] = useState<number>();
  // The raw text typed, so the field can be cleared while editing; the plan uses the clamped number.
  const [daysText, setDaysText] = useState<string>();
  const [hours, setHours] = useState(6);

  const data = useLiveQuery(async () => {
    const [subjects, units, topics, questions, exams, settings] = await Promise.all([
      db.subjects.orderBy("name").toArray(),
      db.units.toArray(),
      db.topics.toArray(),
      db.pyqQuestions.toArray(),
      db.exams.where("date").aboveOrEqual(today).toArray(),
      getSettings(),
    ]);
    const mode = settings.examMode;
    return { subjects, units, topics, questions, mode, exams: exams.filter((e) => examInMode(e, mode)).sort(byWhen) };
  }, [today]);

  const header = <PageHeader title="Start here" sub="Exam soon and nothing studied? Learn these topics, in this order." />;
  if (!data) return header;
  if (!data.subjects.length) {
    return (
      <>
        {header}
        <Empty icon={<Compass size={28} />} title="Add your subjects first">
          Add them on <Link href="/subjects" className={link}>Subjects</Link> with their syllabus. A plan is made from each one&apos;s topics and past papers.
        </Empty>
      </>
    );
  }

  // The subject picked, else the one with the nearest exam, else the first. Days default to that exam.
  const subjectId = picked ?? data.exams[0]?.subjectId ?? data.subjects[0].id!;
  const exam = data.exams.find((e) => e.subjectId === subjectId);
  const typedDays = Math.round(Number(daysText));
  const days = daysText && typedDays > 0 ? Math.min(60, typedDays) : exam ? Math.max(1, daysBetween(today, exam.date)) : 3;
  const topics = topicsInScope(data.topics, data.units, data.mode).filter((t) => t.subjectId === subjectId);
  const questions = data.questions.filter((q) => q.subjectId === subjectId && (!data.mode || q.exam === data.mode));
  // Done topics stay in, so ticking one off doesn't reshuffle the days.
  const rows = prepRows(topics, data.subjects, questions);
  const plan = crashPlan(rows, days, hours * 60);
  const first = plan.days[0][0];
  const unrated = topics.filter((t) => !t.prep).length;
  const skippedMins = plan.skipped.reduce((a, r) => a + r.prep.mins, 0);

  return (
    <>
      {header}
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end sm:gap-3">
          <label className="col-span-2 space-y-1 text-[13px] text-muted sm:col-span-1">
            <span>Subject</span>
            <Select
              value={subjectId}
              onChange={(e) => {
                setPicked(Number(e.target.value));
                setDaysText(undefined);
              }}
              className="h-9 w-full min-w-0 text-[13px] sm:w-auto sm:max-w-64"
            >
              {data.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </label>
          <label className="space-y-1 text-[13px] text-muted">
            <span>Days to study</span>
            <Input
              type="number"
              min={1}
              max={60}
              value={daysText ?? days}
              onChange={(e) => setDaysText(e.target.value)}
              onBlur={() => daysText !== undefined && setDaysText(String(days))}
              className="w-full text-[13px] sm:w-24"
            />
          </label>
          <label className="space-y-1 text-[13px] text-muted">
            <span>Hours a day</span>
            <Select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="h-9 w-full min-w-0 text-[13px] sm:w-auto">
              {HOURS.map((h) => <option key={h} value={h}>{h} hours</option>)}
            </Select>
          </label>
        </div>

        {run.running ? (
          <p role="status" className="text-[13px] tabular-nums text-muted">{run.message}{run.total > 0 && ` (${run.done} of ${run.total})`}</p>
        ) : run.error ? (
          <AiErrorBox error={run.error} />
        ) : null}

        {!topics.length ? (
          <Empty icon={<Compass size={28} />} title="No syllabus for this subject yet">
            Add it in the subject&apos;s <Link href={`/subjects/view?id=${subjectId}&tab=syllabus`} className={link}>Syllabus tab</Link>, then come back.
          </Empty>
        ) : !rows.length ? (
          <Empty icon={<Compass size={28} />} title="Rate the topics to get a plan">
            The AI reads each topic once and rates how long it takes, how much it matters and what it needs first. The plan ranks them against
            how often your past papers asked them.
            {!run.running && <div><Button className="mt-4" onClick={() => ratePrep({ subjectId })}>Rate my topics</Button></div>}
          </Empty>
        ) : (
          <>
            {unrated > 0 && !run.running && (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted">
                {unrated} topic{unrated === 1 ? " isn't" : "s aren't"} rated yet, so {unrated === 1 ? "it's" : "they're"} not in this plan.
                <Button size="sm" variant="secondary" onClick={() => ratePrep({ subjectId })}>Rate {unrated === 1 ? "it" : "them"}</Button>
              </p>
            )}
            <p className="text-[15px] leading-relaxed">
              Start now with <span className="font-semibold">{first.topic.title}</span>: {formatMins(first.prep.mins)}
              {first.count ? `, asked ${first.count}× in past papers` : ""}. Tick each topic off as you go, and don&apos;t start a new
              topic on exam morning; go over your ticked ones and their past-paper questions instead.
            </p>
            {plan.days.map((day, i) =>
              day.length ? (
                <Panel as="section" key={i}>
                  <h2 className={cn(tableHead, "flex justify-between gap-3 px-4 py-2.5 sm:px-5")}>
                    <span className="text-[14px] font-semibold text-text">Day {i + 1}{i === 0 ? " · today" : ""}</span>
                    <span className="tabular-nums">{formatMins(day.reduce((a, r) => a + r.prep.mins, 0))}</span>
                  </h2>
                  <ul className="divide-y divide-border">
                    {day.map((r) => <PrepTopicRow key={r.topic.id} row={r} showSubject={false} />)}
                  </ul>
                </Panel>
              ) : null,
            )}
            {plan.skipped.length > 0 && (
              <p className="max-w-prose text-[13px] leading-relaxed text-muted">
                <span className="font-medium text-text">Left out ({formatMins(skippedMins)}):</span> {plan.skipped.map((r) => r.topic.title).join(", ")}.
                They pay off least for the time, so get to them only if you finish early.
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
}
