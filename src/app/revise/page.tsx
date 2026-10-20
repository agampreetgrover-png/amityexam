"use client";

import { FlashcardReview } from "@/components/revise/flashcard-review";
import { TopicRevision } from "@/components/revise/topic-revision";
import { PageHeader } from "@/components/ui";

export default function RevisePage() {
  return (
    <>
      <PageHeader title="Revise" sub="Review what's due today so it stays fresh for the exam." />
      <div className="space-y-12">
        <FlashcardReview />
        <TopicRevision />
      </div>
    </>
  );
}
