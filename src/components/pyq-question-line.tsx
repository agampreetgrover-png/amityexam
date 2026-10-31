import type { PyqQuestion, Topic } from "@/lib/types";
import { Badge } from "./ui";

/**
 * One past-paper question as a table-like row: year (or number) column, the question, marks right-aligned.
 * Grouped by paper, `showYear={false}` puts the question number in the column instead.
 */
export function QuestionLine({ q, topic, paperName, showYear = true }: { q: PyqQuestion; topic?: Topic; paperName?: string; showYear?: boolean }) {
  return (
    <li className="flex gap-3 py-3">
      <span className="w-11 shrink-0 pt-0.5 text-[13px] font-medium tabular-nums text-muted">{showYear ? (q.year ?? "—") : q.number}</span>
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-line break-words text-[15px] leading-relaxed">{q.text}</p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] tabular-nums text-muted empty:hidden">
          {/* Phones: marks join this line, so the question gets the full width. */}
          {q.marks ? <Badge className="sm:hidden">{q.marks} marks</Badge> : null}
          {showYear && <span>{q.number}</span>}
          {q.section && <Badge>{q.section}</Badge>}
          {topic && <Badge tone="accent" className="max-w-full"><span className="min-w-0 truncate">{topic.title}</span></Badge>}
          {q.topicId === null && !showYear && <Badge>Not in syllabus</Badge>}
          {paperName && <span className="min-w-0 truncate">{paperName}</span>}
        </p>
      </div>
      {q.marks ? <Badge className="hidden shrink-0 self-start sm:inline-flex">{q.marks} marks</Badge> : null}
    </li>
  );
}
