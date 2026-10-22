"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, Check, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatTile } from "@/components/progress/stat-tile";
import { Badge, Button, cn, Dots, Empty, Section } from "@/components/ui";
import { db, getSettings } from "@/lib/db";
import { daysBetween, prettyDay, today } from "@/lib/dates";
import { topicsInScope } from "@/lib/mode";
import { review } from "@/lib/srs";
import type { Topic } from "@/lib/types";
import { refreshWeak } from "@/lib/weak";

async function markRevised(t: Topic, confidence: number) {
  if (t.id == null) return;
  const d = today();
  const next = review(t, confidence, d);
  await db.topics.update(t.id, {
    confidence,
    status: "revised",
    lastReviewed: d,
    nextReview: next.due,
    ease: next.ease,
    interval: next.interval,
    reps: next.reps,
  });
  await refreshWeak([t.id]);
}

const PAGE = 50; // due topics rendered before "Show all"

/** When a topic is due, with overdue ones called out so they don't read like "due today". */
function when(t: Topic, d: string) {
  if (!t.nextReview) return t.status === "studied" ? "first revision" : "not studied yet";
  if (t.nextReview < d) {
    const n = daysBetween(t.nextReview, d);
    return <span className="font-medium text-warn">overdue {n} day{n === 1 ? "" : "s"}</span>;
  }
  return t.nextReview === d ? "due today" : `due ${prettyDay(t.nextReview)}`;
}

function TopicRow({ t, d, subject }: { t: Topic; d: string; subject?: { name: string; color: string } }) {
  const [picking, setPicking] = useState(false);
  const [conf, setConf] = useState(t.confidence);
  // A second tap while saving would apply the spaced-repetition step twice.
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await markRevised(t, conf);
    } catch {
      setSaving(false); // keep the row so the student can retry
    }
  };
  return (
    <li className={cn("px-4 py-3 transition-colors duration-150", picking ? "bg-surface-2" : "hover:bg-surface-2")}>
      <div className="flex items-center gap-3">
        <span aria-hidden className="h-9 w-[3px] shrink-0 rounded-full" style={{ background: subject?.color }} />
        <div className="min-w-0 flex-1">
          <Link href={`/subjects/view?id=${t.subjectId}`} prefetch={false} className="break-words text-[15px] font-medium text-text transition-colors duration-150 hover:text-accent hover:underline">{t.title}</Link>
          <p className="mt-0.5 text-[13px] text-muted">
            {subject?.name}, {when(t, d)}
            {t.weak && <Badge className="ml-2 bg-bad/10 text-bad">weak</Badge>}
          </p>
        </div>
        {!picking && (
          <Button size="sm" variant="secondary" className="shrink-0" onClick={() => setPicking(true)}>
            <Check size={15} /> Revised
          </Button>
        )}
      </div>
      {picking && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 pl-[15px]">
          <span className="text-[13px] text-muted">How confident are you now?</span>
          <Dots value={conf} onChange={setConf} label="Confidence" />
          <Button size="sm" onClick={save} disabled={saving}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>Cancel</Button>
        </div>
      )}
    </li>
  );
}

export function TopicRevision() {
  const t = today();
  const data = useLiveQuery(async () => {
    const isDue = (x: Topic) => (x.nextReview ? x.nextReview <= t : x.status === "studied");
    const [candidates, subjects, units, settings] = await Promise.all([
      // One getAll and an in-memory filter: Dexie's .filter() steps a cursor through every row.
      db.topics.toArray().then((all) => all.filter((x) => isDue(x) || !!x.weak)),
      db.subjects.toArray(),
      db.units.toArray(),
      getSettings(),
    ]);
    // Only the current mode's syllabus. Weak and overdue first.
    const inScope = topicsInScope(candidates, units, settings.examMode);
    const topics = inScope.filter(isDue);
    topics.sort((a, b) => Number(!!b.weak) - Number(!!a.weak) || (a.nextReview ?? "").localeCompare(b.nextReview ?? ""));
    // Weak topics that aren't due yet still need work; Progress links here for them.
    const weakLater = inScope.filter((x) => x.weak && !isDue(x));
    return { topics, weakLater, subjects: new Map(subjects.map((s) => [s.id!, s])) };
  }, [t]);

  const [showAll, setShowAll] = useState(false);
  const weak = data ? data.topics.filter((x) => x.weak).length : 0;
  const first = data ? data.topics.filter((x) => !x.nextReview).length : 0;
  // A long backlog renders in pages so opening Revise stays quick; weak and overdue topics sort first anyway.
  const shown = data ? (showAll ? data.topics : data.topics.slice(0, PAGE)) : [];

  return (
    <div className="space-y-8">
      {data && (
        <div className="grid grid-cols-2 gap-4">
          <StatTile tone="accent" icon={<RotateCcw />} label="Due to revise" value={data.topics.length} sub={`${first} first revision${first === 1 ? "" : "s"}`} />
          <StatTile tone="warn" icon={<AlertTriangle />} label="Weak and due" value={weak} sub={weak ? "listed first" : "none flagged"} />
        </div>
      )}
      <Section title="Topics to revise" action={data && data.topics.length > 0 && <span className="text-[13px] tabular-nums text-muted">{data.topics.length} due</span>}>
        {!data ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : data.topics.length ? (
          <>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {shown.map((x) => <TopicRow key={x.id} t={x} d={t} subject={data.subjects.get(x.subjectId)} />)}
            </ul>
            {shown.length < data.topics.length && (
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => setShowAll(true)}>
                Show all {data.topics.length}
              </Button>
            )}
          </>
        ) : (
          <Empty title="No topics due for revision">Topics show up here after you study them, spaced out over time.</Empty>
        )}
      </Section>
      {data && data.weakLater.length > 0 && (
        <Section title="Weak, not due yet" action={<span className="text-[13px] tabular-nums text-muted">{data.weakLater.length}</span>}>
          <p className="-mt-1 mb-3 text-[13px] text-muted">Revise these early to lift your confidence before the exam.</p>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {data.weakLater.map((x) => <TopicRow key={x.id} t={x} d={t} subject={data.subjects.get(x.subjectId)} />)}
          </ul>
        </Section>
      )}
    </div>
  );
}
