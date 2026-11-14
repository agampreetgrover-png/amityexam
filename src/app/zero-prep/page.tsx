"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronDown, RotateCw, Sprout } from "lucide-react";
import { useId, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { db, getSettings } from "@/lib/db";
import { modeShort, topicsInScope } from "@/lib/mode";
import { filterPrep, formatMins, prepRows, sortPrep, type AskedFilter, type ImportanceFilter, type PrepFilter, type PrepRow, type PrepSort } from "@/lib/prep";
import { ratePrep, usePrepRun } from "@/lib/prep-run";
import type { Subject } from "@/lib/types";
import { AiErrorBox } from "@/components/ai-error";
import { PrepGlyph, PrepTopicRow } from "@/components/prep-row";
import { Button, Empty, PageHeader, Panel, Progress, Segmented, Select, cn, subjectStyle, tableHead } from "@/components/ui";

const link = "font-medium text-accent underline underline-offset-2";
const FIRST_SHOWN = 60;

export default function ZeroPrepPage() {
  const [prep, setPrep] = useState<PrepFilter>("zero");
  const [asked, setAsked] = useState<AskedFilter>("any");
  const [importance, setImportance] = useState<ImportanceFilter>("any");
  const [subjectId, setSubjectId] = useState<number | "all">("all");
  const [sort, setSort] = useState<PrepSort>("wins");
  const [showAll, setShowAll] = useState(false);
  const run = usePrepRun();

  const data = useLiveQuery(async () => {
    const [subjects, units, topics, questions, settings] = await Promise.all([
      db.subjects.orderBy("name").toArray(),
      db.units.toArray(),
      db.topics.toArray(),
      db.pyqQuestions.toArray(),
      getSettings(),
    ]);
    return { subjects, units, topics, questions, mode: settings.examMode };
  });

  // This exam's syllabus and this exam's past papers only, as on Important topics.
  const scope = useMemo(() => {
    if (!data?.mode) return null;
    const topics = topicsInScope(data.topics, data.units, data.mode);
    const questions = data.questions.filter((q) => q.exam === data.mode);
    // Past-paper questions matched to a syllabus topic: the pool the coverage figure is a share of. Kept as the
    // matched topic's subject, which is what rows are filtered by, so the share can't pass 100%.
    const subjectOf = new Map(topics.map((t) => [t.id, t.subjectId]));
    const matched = questions.flatMap((q) => (typeof q.topicId === "number" && subjectOf.has(q.topicId) ? [subjectOf.get(q.topicId)!] : []));
    return { topics, matched, rows: prepRows(topics, data.subjects, questions), unrated: topics.filter((t) => !t.prep).length };
  }, [data]);

  // A chosen subject that has since lost its rated topics (deleted, other exam mode) falls back to all.
  const subject = scope?.rows.some((r) => r.subject.id === subjectId) ? subjectId : "all";
  const rows = useMemo(
    () => (scope ? sortPrep(filterPrep(scope.rows, { prep, asked, importance, subjectId: subject }), sort) : []),
    [scope, prep, asked, importance, subject, sort],
  );

  if (!data || !data.mode || !scope) return <PageHeader title="Zero prep" sub="Loading…" />;
  const seasonName = modeShort(data.mode).toLowerCase();
  const header = <PageHeader title="Zero prep" sub="Topics you can learn cold, without studying anything else first" />;

  if (!scope.topics.length) {
    return (
      <>
        {header}
        <Empty icon={<Sprout size={28} />} title={`No ${seasonName} syllabus yet`}>
          Add a syllabus to your <Link href="/subjects" className={link}>subjects</Link>. The AI then sorts its topics by how much groundwork each one needs.
        </Empty>
      </>
    );
  }

  if (!scope.rows.length) {
    return (
      <>
        {header}
        {run.running ? (
          <RunStatus run={run} />
        ) : (
          <Empty icon={<Sprout size={28} />} title="Find the topics you can start cold">
            <p>
              The AI reads each of your {scope.topics.length} topics once and rates how much groundwork it needs, how long it takes and how much it
              matters. Then they&apos;re ranked against how often your {seasonName} past papers asked them.
            </p>
            <Button className="mt-4" onClick={() => ratePrep()}>Rate my topics</Button>
            {run.error ? <div className="mt-4"><AiErrorBox error={run.error} /></div> : null}
          </Empty>
        )}
      </>
    );
  }

  const subjectsRated = data.subjects.filter((s) => scope.rows.some((r) => r.subject.id === s.id));
  const shown = showAll ? rows : rows.slice(0, FIRST_SHOWN);
  const resetFilters = () => {
    setAsked("any");
    setImportance("any");
    setSubjectId("all");
  };

  const total = rows.reduce((a, r) => a + r.prep.mins, 0);
  const todo = rows.filter((r) => r.topic.status === "not-started");
  const left = todo.reduce((a, r) => a + r.prep.mins, 0);
  const asks = rows.reduce((a, r) => a + r.count, 0);
  const pool = subject === "all" ? scope.matched.length : scope.matched.filter((s) => s === subject).length;
  const doneCount = rows.length - todo.length;

  // One group per module, subjects by name and modules in syllabus order, so a module there's no time for can be
  // set aside whole and the cold-start topics of every other module are still in view.
  const unitById = new Map(data.units.map((u) => [u.id!, u]));
  const byUnit = new Map<number, PrepRow[]>();
  for (const r of shown) byUnit.set(r.topic.unitId, [...(byUnit.get(r.topic.unitId) ?? []), r]);
  const modules = [...byUnit]
    .map(([unitId, rs]) => ({ unitId, unit: unitById.get(unitId), rows: rs }))
    .sort((a, b) => a.rows[0].subject.name.localeCompare(b.rows[0].subject.name) || (a.unit?.order ?? Infinity) - (b.unit?.order ?? Infinity));

  return (
    <>
      {header}

      <div className="space-y-5">
        {/* Phones: a tidy two-column grid with the switches full width, instead of controls wrapping ragged. */}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <Segmented
            className="col-span-2 flex sm:inline-flex [&>button]:flex-1 sm:[&>button]:flex-none"
            label="How much prep"
            value={prep}
            onChange={(v) => {
              setPrep(v);
              setShowAll(false);
            }}
            options={[
              { value: "zero", label: <><PrepGlyph level={0} />Zero prep</> },
              { value: "light", label: <><PrepGlyph level={1} />Light prep too</> },
            ]}
          />
          {subjectsRated.length > 1 && (
            <Select
              value={subject}
              onChange={(e) => setSubjectId(e.target.value === "all" ? "all" : Number(e.target.value))}
              className="col-span-2 h-9 w-full min-w-0 text-[13px] sm:w-auto sm:max-w-48"
              aria-label="Subject"
            >
              <option value="all">All subjects</option>
              {subjectsRated.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )}
          <Select value={importance} onChange={(e) => setImportance(e.target.value as ImportanceFilter)} className="h-9 w-full min-w-0 text-[13px] sm:w-auto" aria-label="Weight">
            <option value="any">Any weight</option>
            <option value="medium">Core and regular</option>
            <option value="high">Core only</option>
          </Select>
          <Select value={asked} onChange={(e) => setAsked(e.target.value as AskedFilter)} className="h-9 w-full min-w-0 text-[13px] sm:w-auto" aria-label="How often asked">
            <option value="any">Asked or not</option>
            <option value="asked">Asked in PYQs</option>
            <option value="often">Asked 2+ times</option>
            <option value="hot">Most asked</option>
          </Select>
          <Segmented
            size="sm"
            label="Sort by"
            className="col-span-2 flex sm:ml-auto sm:inline-flex [&>button]:flex-1 sm:[&>button]:flex-none"
            value={sort}
            onChange={setSort}
            options={[
              { value: "quick", label: "Quickest" },
              { value: "asked", label: "Most asked" },
              { value: "wins", label: "Best value", title: "Most asked and most important for the time it takes" },
            ]}
          />
        </div>

        {run.running ? <RunStatus run={run} /> : (
          <>
            {run.error ? <AiErrorBox error={run.error} /> : null}
            {scope.unrated > 0 && (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted">
                {scope.unrated} topic{scope.unrated === 1 ? " isn't" : "s aren't"} rated yet, so {scope.unrated === 1 ? "it's" : "they're"} not in this list.
                <Button size="sm" variant="secondary" onClick={() => ratePrep()}>Rate {scope.unrated === 1 ? "it" : "them"}</Button>
              </p>
            )}
            {!scope.unrated && run.message && <p className="text-[13px] text-muted">{run.message}</p>}
          </>
        )}

        {!rows.length ? (
          <Empty icon={<Sprout size={28} />} title="No topics match these filters">
            {prep === "zero" ? "Few topics need nothing at all first. " : ""}Try a wider filter.
            <div className="mt-4 flex flex-wrap gap-2">
              {prep === "zero" && <Button size="sm" onClick={() => setPrep("light")}>Show light prep too</Button>}
              <Button size="sm" variant="secondary" onClick={resetFilters}>Clear filters</Button>
            </div>
          </Empty>
        ) : (
          <>
            <Panel as="section">
              {/* Phones: the two time figures side by side, coverage full width under them. */}
              <div className="grid grid-cols-2 sm:grid-cols-3">
                <Stat label="Study time" value={<Mins mins={total} />} sub={rows.length === 1 ? "To learn this topic" : `To learn all ${rows.length} topics`} />
                <Stat label="Still to learn" className="border-l border-border" value={<Mins mins={left} />} sub={`${doneCount} of ${rows.length} done`}>
                  <Progress className="mt-3" value={(doneCount / rows.length) * 100} label="Topics done" />
                </Stat>
                <Stat
                  label="Past-paper coverage"
                  className="col-span-2 border-t border-border sm:col-span-1 sm:border-l sm:border-t-0"
                  value={pool ? <>{Math.round((asks / pool) * 100)}<Unit>%</Unit></> : <span className="text-faint">—</span>}
                  sub={pool ? `${asks} of ${pool} ${seasonName} question${pool === 1 ? "" : "s"} asked on these topics` : `No ${seasonName} past-paper questions matched yet`}
                />
              </div>
              <div className="border-t border-border px-4 py-4 sm:px-5">
                <TimeStrip rows={rows} />
              </div>
            </Panel>

            <div className="space-y-3">
              {modules.map((m) => (
                <ModuleGroup key={m.unitId} title={m.unit?.title ?? "Other topics"} subject={subject === "all" ? m.rows[0].subject : undefined} rows={m.rows} />
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] tabular-nums text-muted">
              <span>
                {rows.length > FIRST_SHOWN ? `Showing ${shown.length} of ${rows.length}. ` : ""}Ratings are the AI&apos;s judgement from your topic titles.
              </span>
              <span className="flex gap-2">
                {rows.length > FIRST_SHOWN && (
                  <Button size="sm" variant="secondary" onClick={() => setShowAll((v) => !v)}>{showAll ? "Show fewer" : "Show all"}</Button>
                )}
                <Button size="sm" variant="ghost" disabled={run.running} onClick={() => ratePrep({ again: true })}>
                  <RotateCw size={14} /> Rate again
                </Button>
              </span>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** One figure in the banner over the list: a caption, the figure, and a line saying what it counts. */
function Stat({ label, value, sub, className, children }: { label: string; value: ReactNode; sub: string; className?: string; children?: ReactNode }) {
  return (
    <div className={cn("min-w-0 px-4 py-4 sm:px-5", className)}>
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className="numeral mt-3 text-[26px] text-text sm:text-[30px]">{value}</p>
      <p className="mt-2 text-[13px] tabular-nums text-muted">{sub}</p>
      {children}
    </div>
  );
}

/** A unit beside a banner figure, set small so the digits lead. */
function Unit({ children }: { children: ReactNode }) {
  return <span className="text-[15px] font-medium tracking-normal text-muted">{children}</span>;
}

/** "13 h 50 min" with the units set small. */
function Mins({ mins }: { mins: number }) {
  return <>{formatMins(mins).split(/(\d+)/).map((part, i) => (!part ? null : /\d/.test(part) ? part : <Unit key={i}>{part}</Unit>))}</>;
}

/**
 * The list as one stretch of study time: a cell per topic, as wide as the minutes it takes, gathered into one
 * run per subject. Subject colours aren't far enough apart to tell subjects by colour alone (some pairs merge
 * for colour-blind readers), so the runs keep a fixed order by name, sit apart, and the legend names them.
 * Done topics drop to a neutral fill outlined in the subject colour, so what's left reads at a glance in either theme. Every value is also in the list below.
 */
function TimeStrip({ rows }: { rows: PrepRow[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ row: PrepRow; x: number } | null>(null);
  const runs = useMemo(() => {
    const bySubject = new Map<number, { subject: Subject; rows: PrepRow[]; mins: number }>();
    for (const r of rows) {
      const run = bySubject.get(r.subject.id!) ?? { subject: r.subject, rows: [], mins: 0 };
      run.rows.push(r);
      run.mins += r.prep.mins;
      bySubject.set(r.subject.id!, run);
    }
    return [...bySubject.values()].sort((a, b) => a.subject.name.localeCompare(b.subject.name));
  }, [rows]);
  const total = rows.reduce((a, r) => a + r.prep.mins, 0);

  const point = (row: PrepRow) => (e: PointerEvent<HTMLElement>) => {
    const box = wrap.current?.getBoundingClientRect();
    const cell = e.currentTarget.getBoundingClientRect();
    if (box) setHover({ row, x: cell.left + cell.width / 2 - box.left });
  };
  const width = wrap.current?.clientWidth ?? 0;

  return (
    <section aria-label="Study time" className="space-y-2.5">
      <div ref={wrap} className="relative" onPointerLeave={() => setHover(null)}>
        <div role="img" aria-label={`${rows.length} topics, ${formatMins(total)} in total`} className="flex w-full gap-1.5">
          {runs.map((run) => (
            <div key={run.subject.id} className="flex min-w-0 gap-px overflow-clip [overflow-clip-margin:3px] sm:gap-[2px]" style={{ ...subjectStyle(run.subject.color), flexGrow: run.mins, flexBasis: 0 }}>
              {run.rows.map((r, i) => (
                // The hit area is the full 24px band; only the middle 12px is painted.
                <span key={r.topic.id} onPointerEnter={point(r)} className="flex h-6 min-w-px items-center" style={{ flexGrow: r.prep.mins, flexBasis: 0 }}>
                  <span
                    className={cn(
                      "h-3 w-full rounded-[1px] transition-[background-color,box-shadow] duration-250 ease-snappy",
                      i === 0 && "rounded-l-[4px]",
                      i === run.rows.length - 1 && "rounded-r-[4px]",
                      r.topic.status === "not-started" ? "subj-dot" : "bg-surface-3 shadow-[inset_0_0_0_1px_var(--subj)]",
                      hover?.row === r && "outline outline-[1.5px] outline-offset-1 outline-text",
                    )}
                  />
                </span>
              ))}
            </div>
          ))}
        </div>
        {hover && (
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-full z-10 mb-1 w-max max-w-56 -translate-x-1/2 rounded-lg border border-border bg-surface px-3 py-2 shadow-float"
            // Kept inside the strip so it never runs off the page edge.
            style={{ left: Math.min(Math.max(hover.x, 112), Math.max(112, width - 112)) }}
          >
            <p className="text-[15px] font-semibold tabular-nums text-text">{formatMins(hover.row.prep.mins)}</p>
            <p className="text-[13px] leading-snug text-text">{hover.row.topic.title}</p>
            <p className="mt-1 flex items-center gap-1.5 text-[12px] text-muted" style={subjectStyle(hover.row.subject.color)}>
              <span className="subj-dot h-0.5 w-3 rounded-full" />
              {hover.row.subject.name}
              {hover.row.count > 0 && <span className="tabular-nums">, asked {hover.row.count}×</span>}
            </p>
          </div>
        )}
      </div>
      {runs.length > 1 && (
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-muted" aria-label="Subjects">
          {runs.map((run) => (
            <li key={run.subject.id} className="inline-flex min-w-0 max-w-full items-center gap-2" style={subjectStyle(run.subject.color)}>
              <span aria-hidden className="subj-dot h-2.5 w-3.5 shrink-0 rounded-[2px]" />
              <span className="min-w-0 truncate text-text" title={run.subject.name}>{run.subject.name}</span>
              <span className="whitespace-nowrap tabular-nums">{formatMins(run.mins)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A module's topics under a header that folds away, with what the module takes and how often it's asked. */
function ModuleGroup({ title, subject, rows }: { title: string; subject?: Subject; rows: PrepRow[] }) {
  const [open, setOpen] = useState(true);
  const id = useId();
  const mins = rows.reduce((a, r) => a + r.prep.mins, 0);
  const asked = rows.reduce((a, r) => a + r.count, 0);
  return (
    <Panel as="section">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className={cn(tableHead, "flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2 sm:px-5", !open && "border-b-0")}
        style={subject ? subjectStyle(subject.color) : undefined}
      >
        <ChevronDown size={16} aria-hidden className={cn("w-[22px] shrink-0 transition-transform duration-150 ease-snappy", !open && "-rotate-90")} />
        <span className="min-w-0 flex-1">
          <span className="break-words text-[14px] font-semibold text-text">{title}</span>
          {subject && (
            <span className="ml-2 inline-flex items-center gap-1.5 align-middle">
              <span aria-hidden className="subj-dot h-2 w-2 rounded-full" />
              {subject.code || subject.name}
            </span>
          )}
        </span>
        <span className="shrink-0 tabular-nums">
          {rows.length} topic{rows.length === 1 ? "" : "s"} · {formatMins(mins)}{asked ? ` · asked ${asked}×` : ""}
        </span>
      </button>
      {open && (
        <ul id={id} className="divide-y divide-border">
          {rows.map((r) => <PrepTopicRow key={r.topic.id} row={r} showSubject={false} />)}
        </ul>
      )}
    </Panel>
  );
}

function RunStatus({ run }: { run: ReturnType<typeof usePrepRun> }) {
  return (
    <div role="status" className="count-in space-y-2 rounded-2xl border border-border bg-surface px-5 py-4 shadow-sheet">
      <p className="flex justify-between gap-3 text-[13px] tabular-nums text-muted">
        <span>{run.message}</span>
        {run.total > 0 && <span>{run.done} of {run.total}</span>}
      </p>
      <Progress value={run.total ? (run.done / run.total) * 100 : 5} />
    </div>
  );
}
