"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { CalendarPlus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { makeLookup } from "@/components/planner/lookup";
import { Pomodoro } from "@/components/planner/pomodoro";
import { TimelineView } from "@/components/planner/timeline-view";
import { TodayView } from "@/components/planner/today-view";
import { WeekView } from "@/components/planner/week-view";
import { Button, Card, Empty, List, PageHeader, Tabs, cn } from "@/components/ui";
import { downloadText } from "@/lib/download";
import { db } from "@/lib/db";
import { today } from "@/lib/dates";
import { examInMode, modeShort } from "@/lib/mode";
import { sessionMode, type PlanResult } from "@/lib/planner";
import { replan } from "@/lib/replan";
import { fmtMins } from "@/lib/stats";
import { DEFAULT_SETTINGS, type StudySession } from "@/lib/types";

type View = "today" | "week" | "timeline";
const VIEWS: { value: View; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "Week" },
  { value: "timeline", label: "Countdown" },
];

export default function PlannerPage() {
  const data = useLiveQuery(async () => {
    const [subjects, topics, units, exams, sessions, settings] = await Promise.all([
      db.subjects.toArray(),
      db.topics.toArray(),
      db.units.toArray(),
      db.exams.toArray(),
      db.sessions.orderBy("date").toArray(),
      db.settings.get("settings"),
    ]);
    return { subjects, topics, units, exams, sessions, settings: settings ?? DEFAULT_SETTINGS };
  });

  const [view, setView] = useState<View>("today");
  const [busy, setBusy] = useState(false);
  const [unscheduled, setUnscheduled] = useState<PlanResult["unscheduled"] | null>(null);
  const [message, setMessage] = useState("");
  const [timer, setTimer] = useState<{ id: number; label: string } | null>(null);

  const lookup = useMemo(
    () => (data ? makeLookup(data.subjects, data.topics, data.units, data.exams) : null),
    [data],
  );

  if (!data || !lookup) return <PageHeader title="Planner" sub="Loading…" />;

  const t = today();
  const missed = data.sessions.filter((s) => s.date < t && !s.done);
  const todays = data.sessions.filter((s) => s.date === t);
  const mode = data.settings.examMode;
  // Only this season's exams can be planned; the button stays off when there are none.
  const hasUpcoming = data.exams.some((e) => e.date >= t && examInMode(e, mode));
  // Unfinished future blocks from the other season, e.g. right after switching mid-sem ↔ major.
  const stale = mode ? data.sessions.filter((s) => !s.done && s.date >= t && (sessionMode(s, lookup) ?? mode) !== mode).length : 0;

  const runReplan = async () => {
    setBusy(true);
    setMessage("");
    try {
      const res = await replan();
      setUnscheduled(res.unscheduled);
      setMessage(`Plan updated: ${res.sessions.length} sessions scheduled.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not generate plan");
    } finally {
      setBusy(false);
    }
  };

  const exportIcs = async () => {
    try {
      // The calendar library is only needed for this button, so it loads on click.
      const { buildIcs } = await import("@/lib/calendar");
      const ics = buildIcs({ exams: data.exams, sessions: data.sessions, subjects: data.subjects, topics: data.topics });
      if (!ics) return setMessage("Nothing upcoming to export yet.");
      downloadText(ics, "amity-exams.ics", "text/calendar;charset=utf-8");
      setMessage("Calendar file downloaded. Import it in Google Calendar under Settings, Import & export.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not build the calendar file");
    }
  };

  if (!data.topics.length || !data.exams.length) {
    return (
      <>
        <PageHeader title="Planner" />
        <Empty title="Add your subjects and exams first">
          The planner needs {!data.topics.length && <Link href="/subjects" className="text-accent underline underline-offset-2">subjects with topics</Link>}
          {!data.topics.length && !data.exams.length && " and "}
          {!data.exams.length && <Link href="/exams" className="text-accent underline underline-offset-2">exam dates</Link>} to build a schedule.
        </Empty>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Planner"
        sub={`${fmtMins(data.settings.dailyMinutes)} a day, ${data.settings.revisionDays} revision day${data.settings.revisionDays === 1 ? "" : "s"} before each exam`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={exportIcs}><CalendarPlus size={16} /> Export to calendar</Button>
            <Button onClick={runReplan} disabled={busy || !hasUpcoming}>
              <RefreshCw size={16} className={cn(busy && "animate-spin")} /> {data.sessions.length ? "Rebalance plan" : "Generate plan"}
            </Button>
          </div>
        }
      />

      <div className="space-y-8">
        {message && (
          <p className="rounded-md border border-accent/20 bg-accent-soft px-4 py-3 text-sm text-text" role="status">{message}</p>
        )}

        {stale > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-accent/20 bg-accent-soft px-4 py-3 text-sm text-text">
            <span>
              <span className="font-semibold">Your plan is still for the other exam.</span>{" "}
              Rebalance to plan for your {modeShort(mode!)} exams instead.
            </span>
            <Button size="sm" onClick={runReplan} disabled={busy}>Rebalance</Button>
          </div>
        )}

        {missed.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-mark/40 bg-mark-soft px-4 py-3 text-sm text-text">
            <span>
              <span className="font-semibold text-warn">{missed.length} missed session{missed.length > 1 ? "s" : ""}.</span>{" "}
              Rebalance to fit that work into the days you have left.
            </span>
            <Button size="sm" onClick={runReplan} disabled={busy}>Rebalance</Button>
          </div>
        )}

        {unscheduled && unscheduled.length > 0 && (
          <Card title={<span className="text-warn">Not everything fits</span>}>
            <List className="mb-3 border-y-0">
              {unscheduled.map((u) => {
                const topic = lookup.topics.get(u.topicId);
                const exam = lookup.exams.get(u.examId);
                return (
                  <li key={`${u.topicId}-${u.examId}`} className="flex justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0 truncate">
                      {topic?.title ?? "Topic"}
                      {exam && <span className="ml-2 text-muted">{lookup.subjects.get(exam.subjectId)?.name}</span>}
                    </span>
                    <span className="shrink-0 tabular-nums text-warn">{fmtMins(u.minutes)} short</span>
                  </li>
                );
              })}
            </List>
            <p className="text-[13px] text-muted">
              Add study hours in <Link href="/settings" className="text-accent underline underline-offset-2">Settings</Link>, mark topics you already know as studied, or lower their difficulty.
            </p>
          </Card>
        )}

        {!data.sessions.length && hasUpcoming && (
          <Empty title="No plan yet">Press Generate plan to build a day-by-day schedule up to your exams.</Empty>
        )}
        {!hasUpcoming && mode && (
          <Empty title={`No upcoming ${modeShort(mode)} exams`}>
            Add your {modeShort(mode)} dates on the <Link href="/exams" className="text-accent underline underline-offset-2">Exams</Link> page to build a plan.
          </Empty>
        )}

        <div>
          <Tabs label="Planner view" value={view} onChange={setView} options={VIEWS} className="mb-5" />

          {view === "today" && (
            <TodayView
              sessions={todays}
              hasPlan={data.sessions.length > 0}
              lookup={lookup}
              dailyMinutes={data.settings.dailyMinutes}
              onStart={(s: StudySession, label) => s.id != null && setTimer({ id: s.id, label })}
            />
          )}
          {view === "week" && <WeekView sessions={data.sessions} exams={data.exams} lookup={lookup} dailyMinutes={data.settings.dailyMinutes} />}
          {view === "timeline" && <TimelineView exams={data.exams} topics={data.topics} sessions={data.sessions} lookup={lookup} />}
        </div>
      </div>

      <Pomodoro sessionId={timer?.id ?? null} label={timer?.label ?? ""} onClose={() => setTimer(null)} />
    </>
  );
}
