"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { Empty, Section, Select, cn } from "@/components/ui";
import { db } from "@/lib/db";
import { today } from "@/lib/dates";
import { review } from "@/lib/srs";
import type { Flashcard } from "@/lib/types";

const GRADES = [
  { label: "Again", grade: 1, key: "1", cls: "text-bad" },
  { label: "Hard", grade: 3, key: "2", cls: "text-warn" },
  { label: "Good", grade: 4, key: "3", cls: "text-text" },
  { label: "Easy", grade: 5, key: "4", cls: "text-good" },
];

export function FlashcardReview() {
  const [subjectId, setSubjectId] = useState<number | "all">("all");
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const t = today();

  const subjects = useLiveQuery(() => db.subjects.toArray()) ?? [];
  const due = useLiveQuery(
    () => db.flashcards.where("due").belowOrEqual(t).filter((c) => subjectId === "all" || c.subjectId === subjectId).toArray(),
    [t, subjectId],
  );
  const card: Flashcard | undefined = due?.[0];
  // The live query yields a fresh object after each update, so this ignores repeat
  // clicks/keys on a card that was already graded but hasn't re-rendered yet.
  const graded = useRef<Flashcard | null>(null);

  const grade = useCallback(
    async (g: number) => {
      if (!card?.id || graded.current === card) return;
      graded.current = card;
      const next = review(card, g, t);
      // "Again" cards stay due today so they come back in this sitting.
      await db.flashcards.update(card.id, { ...next, due: g < 3 ? t : next.due });
      setFlipped(false);
      setReviewed((r) => r + 1);
    },
    [card, t],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card || (e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.code === "Space") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (flipped) {
        const g = GRADES.find((x) => x.key === e.key);
        if (g) grade(g.grade);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, flipped, grade]);

  return (
    <Section
      title="Flashcards"
      action={
        <Select
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value === "all" ? "all" : Number(e.target.value))}
          className="h-8 w-40 py-0 text-[13px]"
          aria-label="Filter by subject"
        >
          <option value="all">All subjects</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      }
    >
      {!due ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !card ? (
        <Empty title={reviewed ? "Done for today" : "No cards due"}>
          {reviewed ? `You reviewed ${reviewed} card${reviewed > 1 ? "s" : ""}.` : "Generate flashcards from a subject's Flashcards tab."}
        </Empty>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            {subjects.find((s) => s.id === card.subjectId)?.name}
            <span className="float-right tabular-nums">
              {due.length} left{reviewed ? `, ${reviewed} done` : ""}
            </span>
          </p>
          <button
            type="button"
            onClick={() => setFlipped((f) => !f)}
            aria-label={flipped ? "Hide answer" : "Reveal answer"}
            className="flex min-h-64 w-full flex-col items-center justify-center gap-5 rounded-2xl border border-border bg-surface px-6 py-10 text-center"
          >
            <span className="max-w-xl text-xl font-semibold leading-snug tracking-tight md:text-2xl">{card.front}</span>
            {flipped ? (
              <span className="max-w-xl border-t border-border pt-5 text-[15px] leading-relaxed whitespace-pre-wrap">{card.back}</span>
            ) : (
              <span className="text-sm text-muted">Tap, or press Space, to see the answer</span>
            )}
          </button>
          {flipped && (
            <div className="grid grid-cols-4 gap-2">
              {GRADES.map((g) => (
                <button
                  key={g.label}
                  type="button"
                  onClick={() => grade(g.grade)}
                  className={cn("flex flex-col items-center gap-0.5 rounded-xl border border-border bg-surface py-2.5 text-sm font-semibold hover:bg-surface-2", g.cls)}
                >
                  {g.label}
                  <span className="text-[11px] font-normal text-muted">{g.key}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
