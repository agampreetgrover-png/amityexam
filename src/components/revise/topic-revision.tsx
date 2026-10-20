"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, Check, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatTile } from "@/components/progress/stat-tile";
import { Button, Card, Dots, Empty, List } from "@/components/ui";
import { db, getSettings } from "@/lib/db";
import { prettyDay, today } from "@/lib/dates";
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

function TopicRow({ t, subject }: { t: Topic; subject?: { name: string; color: string } }) {
  const [picking, setPicking] = useState(false);
  const [conf, setConf] = useState(t.confidence);
  return (
    <li className="py-3.5">
      <div className="flex items-center gap-3">
        <span className="h-10 w-1 shrink-0 rounded-full" style={{ background: subject?.color }} />
        <div className="min-w-0 flex-1">
          <Link href={`/subjects/${t.subjectId}`} className="text-[15px] font-semibold hover:underline hover:underline-offset-2">{t.title}</Link>
          <p className="mt-0.5 text-[13px] text-muted">
            {subject?.name}, {t.nextReview ? `due ${prettyDay(t.nextReview)}` : "first revision"}
            {t.weak && <span className="ml-2 rounded-md bg-bad/10 px-1.5 py-px text-[11px] font-semibold text-bad">weak</span>}
          </p>
        </div>
        {!picking && (
          <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
            <Check size={15} /> Revised
          </Button>
        )}
      </div>
      {picking && (
        <div className="mt-3 flex flex-wrap items-center gap-3 pl-4">
          <span className="text-sm text-muted">How confident are you now?</span>
          <Dots value={conf} onChange={setConf} label="Confidence" />
          <Button size="sm" onClick={() => markRevised(t, conf)}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>Cancel</Button>
        </div>
      )}
    </li>
  );
}

export function TopicRevision() {
  const t = today();
  const data = useLiveQuery(async () => {
    const [due, subjects, units, settings] = await Promise.all([
      db.topics.filter((x) => (x.nextReview ? x.nextReview <= t : x.status === "studied")).toArray(),
      db.subjects.toArray(),
      db.units.toArray(),
      getSettings(),
    ]);
    // Only the current mode's syllabus. Weak and overdue first.
    const topics = topicsInScope(due, units, settings.examMode);
    topics.sort((a, b) => Number(!!b.weak) - Number(!!a.weak) || (a.nextReview ?? "").localeCompare(b.nextReview ?? ""));
    return { topics, subjects: new Map(subjects.map((s) => [s.id!, s])) };
  }, [t]);

  const weak = data ? data.topics.filter((x) => x.weak).length : 0;
  const first = data ? data.topics.filter((x) => !x.nextReview).length : 0;

  return (
    <div className="space-y-6">
      {data && (
        <div className="grid grid-cols-2 gap-4">
          <StatTile tone="indigo" icon={<RotateCcw />} label="Due to revise" value={data.topics.length} sub={`${first} first revision${first === 1 ? "" : "s"}`} />
          <StatTile tone="amber" icon={<AlertTriangle />} label="Weak and due" value={weak} sub={weak ? "listed first" : "none flagged"} />
        </div>
      )}
      <Card title="Topics to revise" action={data && data.topics.length > 0 && <span className="text-sm text-muted">{data.topics.length} due</span>}>
        {!data ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : data.topics.length ? (
          <List className="border-y-0">
            {data.topics.map((x) => <TopicRow key={x.id} t={x} subject={data.subjects.get(x.subjectId)} />)}
          </List>
        ) : (
          <Empty title="No topics due for revision">Topics show up here after you study them, spaced out over time.</Empty>
        )}
      </Card>
    </div>
  );
}
