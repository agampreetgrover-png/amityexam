"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, Dots, Empty, List, Section } from "@/components/ui";
import { db } from "@/lib/db";
import { prettyDay, today } from "@/lib/dates";
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
    <li className="py-3">
      <div className="flex items-center gap-3">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: subject?.color }} />
        <div className="min-w-0 flex-1">
          <Link href={`/subjects/${t.subjectId}`} className="font-medium hover:underline">{t.title}</Link>
          <p className="text-xs text-muted">
            {subject?.name}, {t.nextReview ? `due ${prettyDay(t.nextReview)}` : "first revision"}
            {t.weak && <span className="ml-2 font-medium text-bad">weak</span>}
          </p>
        </div>
        {!picking && (
          <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
            <Check size={15} /> Revised
          </Button>
        )}
      </div>
      {picking && (
        <div className="mt-3 flex flex-wrap items-center gap-3 pl-5">
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
    const [topics, subjects] = await Promise.all([
      db.topics.filter((x) => (x.nextReview ? x.nextReview <= t : x.status === "studied")).toArray(),
      db.subjects.toArray(),
    ]);
    // Weak and overdue first.
    topics.sort((a, b) => Number(!!b.weak) - Number(!!a.weak) || (a.nextReview ?? "").localeCompare(b.nextReview ?? ""));
    return { topics, subjects: new Map(subjects.map((s) => [s.id!, s])) };
  }, [t]);

  return (
    <Section title="Topics to revise" action={data && data.topics.length > 0 && <span className="text-sm text-muted">{data.topics.length} due</span>}>
      {!data ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : data.topics.length ? (
        <List>
          {data.topics.map((x) => <TopicRow key={x.id} t={x} subject={data.subjects.get(x.subjectId)} />)}
        </List>
      ) : (
        <Empty title="No topics due for revision">Topics show up here after you study them, spaced out over time.</Empty>
      )}
    </Section>
  );
}
