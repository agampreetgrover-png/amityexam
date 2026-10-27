import type { PyqQuestion } from "@/lib/types";

/** One past-paper question under an expanded topic: year, the question, marks. */
export function QuestionLine({ q }: { q: PyqQuestion }) {
  return (
    <li className="flex gap-3 py-2.5">
      <span className="w-11 shrink-0 pt-0.5 text-[13px] font-medium tabular-nums text-muted">{q.year ?? "—"}</span>
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-line break-words text-[14px] leading-relaxed">{q.text}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[12px] tabular-nums text-muted empty:hidden">
          <span>{q.number}</span>
          {q.section && <span>{q.section}</span>}
        </p>
      </div>
      {q.marks ? <span className="shrink-0 whitespace-nowrap pt-0.5 text-right text-[13px] tabular-nums text-muted">{q.marks} marks</span> : null}
    </li>
  );
}
