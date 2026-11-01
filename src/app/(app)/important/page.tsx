"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronDown, ChevronRight, Flame, Search } from "lucide-react";
import { useId, useMemo, useState, useSyncExternalStore } from "react";
import { db, getSettings } from "@/lib/db";
import { modeShort } from "@/lib/mode";
import { importantTopics, type ImportantTopic } from "@/lib/pyq/group";
import { QuestionLine } from "@/components/pyq-question-line";
import { Badge, Button, buttonClass, Empty, Input, PageHeader, Panel, Select, cn, subjectStyle, tableHead } from "@/components/ui";

// Enough to open the page quickly on a big question bank; the rest is a tap away.
const FIRST_SHOWN = 60;
// From here the list and the chosen topic's questions sit side by side; narrower, a row opens in place.
// Below this the side panel would squeeze the topic column to a few words.
const SIDE_BY_SIDE = "(min-width: 90rem)";

// Outside the hook so React doesn't resubscribe to the media query on every render.
const subscribeWide = (cb: () => void) => {
  const mq = window.matchMedia(SIDE_BY_SIDE);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

function useSideBySide() {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(SIDE_BY_SIDE).matches, () => false);
}

const span = (years: [number, number] | null) => (years ? (years[0] === years[1] ? `${years[0]}` : `${years[0]}–${years[1]}`) : null);
const plural = (n: number, word: string) => `${word}${n === 1 ? "" : "s"}`;
const pyqsHref = (stat: ImportantTopic) => `/subjects/view?id=${stat.subject.id}&tab=pyqs`;

export default function ImportantTopicsPage() {
  const [subjectId, setSubjectId] = useState<number | "all">("all");
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [refiltered, setRefiltered] = useState(false);
  const wide = useSideBySide();

  // Everything in one query, so the ranking draws once rather than reshuffling as each table loads.
  const data = useLiveQuery(async () => {
    const [subjects, topics, questions, settings] = await Promise.all([
      db.subjects.orderBy("name").toArray(),
      db.topics.toArray(),
      db.pyqQuestions.toArray(),
      getSettings(),
    ]);
    return { subjects, topics, questions, mode: settings.examMode };
  });

  // Only this exam's questions count: a major prediction shouldn't be swayed by mid-sem papers, or the reverse.
  // (A question's exam tag is set from its paper when it's matched to a topic.)
  const ranked = useMemo(() => {
    if (!data) return [];
    const scoped = data.questions.filter((q) => q.exam === data.mode);
    return importantTopics(scoped, data.topics, data.subjects);
  }, [data]);

  if (!data || !data.mode) return <PageHeader title="Important topics" sub="Loading…" />;
  const { subjects, mode } = data;
  const seasonName = modeShort(mode).toLowerCase();

  if (!subjects.length) {
    return (
      <>
        <PageHeader title="Important topics" />
        <Empty title="Nothing ranked yet">
          Add subjects, then sync or upload past papers. Their questions are matched to your syllabus and the most-asked topics show up here.
          <div className="mt-4">
            <Link href="/subjects" className={buttonClass("primary", "md", "group")}>
              Go to Subjects <ChevronRight size={16} aria-hidden className="transition-transform duration-200 ease-snappy group-hover:translate-x-0.5" />
            </Link>
          </div>
        </Empty>
      </>
    );
  }

  // Which subjects actually have asked topics in this mode — the only ones worth offering in the filter.
  const withTopics = subjects.filter((s) => ranked.some((r) => r.subject.id === s.id));
  // The picked subject may have no ranked topics after a mode switch (and then the filter is hidden): show all.
  const filter = withTopics.some((s) => s.id === subjectId) ? subjectId : "all";
  const rows = filter === "all" ? ranked : ranked.filter((r) => r.subject.id === filter);
  // A topic keeps its rank while searching, so "#12" still means the twelfth most asked.
  const needle = query.trim().toLowerCase();
  const matched = rows.map((stat, i) => ({ stat, rank: i + 1 })).filter((r) => !needle || r.stat.topic.title.toLowerCase().includes(needle));
  const shown = showAll ? matched : matched.slice(0, FIRST_SHOWN);
  const showSubject = filter === "all";
  const hasMarks = rows.some((r) => r.marks > 0);
  // Side by side, something is always open: the picked topic while it's on screen, else the top one.
  const selected = shown.find((r) => r.stat.topic.id === picked)?.stat ?? shown[0]?.stat;

  return (
    // data-wide: the layout gives this page a wider column, room for the questions beside the list.
    <div data-wide>
      <PageHeader
        title="Important topics"
        sub={`The topics asked most often in your ${seasonName} past papers`}
        action={
          withTopics.length > 1 && (
            <Select
              value={filter}
              onChange={(e) => {
                setSubjectId(e.target.value === "all" ? "all" : Number(e.target.value));
                setShowAll(false);
                setRefiltered(true);
              }}
              className="h-9 w-full text-[13px] sm:w-44"
              aria-label="Filter by subject"
            >
              <option value="all">All subjects</option>
              {withTopics.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )
        }
      />

      {!rows.length ? (
        <Empty title={`No ranked ${seasonName} topics yet`}>
          Once your {seasonName} past papers are split into questions and matched to the syllabus, the most-asked topics appear here. Check a subject&apos;s{" "}
          <span className="font-medium text-text">PYQs</span> tab to see how the analysis is going, or switch the exam mode for the other season.
          <div className="mt-4">
            <Link href="/subjects" className={buttonClass("secondary", "md", "group")}>
              Go to Subjects <ChevronRight size={16} aria-hidden className="transition-transform duration-200 ease-snappy group-hover:translate-x-0.5" />
            </Link>
          </div>
        </Empty>
      ) : (
        <div className="space-y-6">
          <Summary rows={rows} />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="relative w-full max-w-sm">
              <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                // Escape clears in every browser, not only those that build it into search fields.
                onKeyDown={(e) => {
                  if (e.key === "Escape" && query) {
                    e.preventDefault();
                    setQuery("");
                  }
                }}
                placeholder="Search topics"
                aria-label="Search topics"
                className="pl-9"
              />
            </div>
            {/* Always mounted, so screen readers hear the count change as you type. */}
            <p className="text-[13px] tabular-nums text-muted empty:hidden" aria-live="polite">
              {needle ? `${matched.length} of ${rows.length} ${plural(rows.length, "topic")}` : null}
            </p>
          </div>

          <div className="min-[90rem]:grid min-[90rem]:grid-cols-[minmax(0,1fr)_24rem] min-[90rem]:items-start min-[90rem]:gap-6">
            <div className="space-y-4">
              <Panel>
                <div className={cn(tableHead, "hidden items-center gap-3 py-2.5 pl-5 pr-5 sm:flex")}>
                  <span className="w-7 shrink-0 tabular-nums">#</span>
                  <span className="flex-1">Topic</span>
                  <span className="w-24 shrink-0">Asked</span>
                  {hasMarks && <span className="w-16 shrink-0 text-center">Marks</span>}
                  <span className="w-28 shrink-0 pl-3">Years</span>
                  {!wide && <span aria-hidden className="w-4 shrink-0" />}
                </div>
                {shown.length ? (
                  // Changing the subject re-keys the list so it settles in, marking the change (but not on first load).
                  <ul key={String(filter)} className={cn("divide-y divide-border", refiltered && "tab-in")}>
                    {shown.map(({ stat, rank }) => (
                      <Row
                        key={stat.topic.id}
                        rank={rank}
                        stat={stat}
                        showSubject={showSubject}
                        hasMarks={hasMarks}
                        wide={wide}
                        selected={wide && stat === selected}
                        onSelect={() => setPicked(stat.topic.id ?? null)}
                      />
                    ))}
                  </ul>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-muted">
                    <span>No topics match &ldquo;{query.trim()}&rdquo;.</span>
                    <Button size="sm" variant="secondary" onClick={() => setQuery("")}>Clear search</Button>
                  </div>
                )}
              </Panel>

              {matched.length > FIRST_SHOWN && (
                <div className="flex items-center justify-between gap-2 text-[13px] tabular-nums text-muted">
                  <span>Showing {shown.length} of {matched.length}</span>
                  <Button size="sm" variant="secondary" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "Show fewer" : "Show all"}
                  </Button>
                </div>
              )}
            </div>

            {wide && selected && <Detail stat={selected} animate={picked !== null} />}
          </div>
        </div>
      )}
    </div>
  );
}

/** The headline figures for the topics in view, all counted from the matched questions. */
function Summary({ rows }: { rows: ImportantTopic[] }) {
  const questions = rows.flatMap((r) => r.questions);
  const hot = rows.filter((r) => r.hot).length;
  const marks = rows.reduce((a, r) => a + r.marks, 0);
  const marked = questions.filter((q) => q.marks).length;
  const papers = new Set(questions.map((q) => q.materialId)).size;
  const subjects = new Set(rows.map((r) => r.subject.id)).size;
  const years = rows.flatMap((r) => r.years ?? []);
  const tiles = [
    { label: plural(rows.length, "Topic") + " asked", value: rows.length, note: hot ? `${hot} most asked` : undefined },
    { label: "Past paper " + plural(questions.length, "question"), value: questions.length, note: `across ${subjects} ${plural(subjects, "subject")}` },
    // Marks are only printed on some papers, so say how many questions the total covers.
    marks > 0 && { label: "Marks asked", value: marks, note: `from ${marked} of ${questions.length} ${plural(questions.length, "question")}` },
    { label: plural(papers, "Paper"), value: papers, note: span(years.length ? [Math.min(...years), Math.max(...years)] : null) ?? undefined },
  ].filter((t) => !!t);
  return (
    // One sheet ruled into cells (the 1px gaps show the border colour through), as on Zero prep, rather than a
    // grid of separate cards. Two across on phones and tablets, one row from lg.
    <Panel>
      <dl className="grid grid-cols-2 gap-px bg-border lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none">
        {tiles.map((t, i) => (
          <div
            key={t.label}
            // An odd last figure spans the row on two columns, so no empty cell shows the rule colour.
            className={cn("flex min-w-0 flex-col bg-surface px-4 py-4 sm:px-5", i === tiles.length - 1 && i % 2 === 0 && "col-span-2 lg:col-span-1")}
          >
            <dt className="text-[13px] text-muted">{t.label}</dt>
            <dd className="order-first numeral pb-2 text-[26px] text-text sm:text-[28px]">{t.value}</dd>
            {t.note && <dd className="mt-1 text-xs tabular-nums text-muted">{t.note}</dd>}
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function Row({ rank, stat, showSubject, hasMarks, wide, selected, onSelect }: {
  rank: number;
  stat: ImportantTopic;
  showSubject: boolean;
  hasMarks: boolean;
  wide: boolean; // side by side: a click picks the topic for the panel beside the list
  selected: boolean;
  onSelect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { topic, subject, count, years, marks, hot } = stat;
  const when = span(years);
  const expanded = !wide && open;
  const panelId = useId();
  return (
    <li style={subjectStyle(subject.color)}>
      <div
        className={cn(
          "group relative flex items-center transition-colors duration-150 hover:bg-surface-2/60 focus-within:bg-surface-2/60",
          // The open row keeps its wash, so it reads as the head of the questions under it.
          expanded && "bg-surface-2/40",
          selected && "bg-accent-soft hover:bg-accent-soft focus-within:bg-accent-soft",
        )}
      >
        {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
        <button
          type="button"
          onClick={() => (wide ? onSelect() : setOpen((o) => !o))}
          {...(wide ? { "aria-pressed": selected } : { "aria-expanded": open, "aria-controls": open ? panelId : undefined })}
          className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-4 text-left transition-colors duration-150 focus-visible:-outline-offset-2 active:bg-surface-2 sm:px-5"
        >
          <span className={cn("numeral w-6 shrink-0 text-[15px] transition-colors duration-150 sm:w-7", selected || expanded ? "text-text" : "text-muted")}>{rank}</span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] font-medium">
              <span className="min-w-0 break-words">{topic.title}</span>
              {hot && <Badge tone="warn"><Flame aria-hidden />Most asked</Badge>}
            </p>
            {/* Phones fold the Asked, Marks and Years columns in here, so the title keeps the row's full width. */}
            <p className={cn("mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] tabular-nums text-muted", !showSubject && "sm:hidden")}>
              <Badge tone={hot ? "accent" : "neutral"} className="sm:hidden">{count}× asked</Badge>
              {showSubject && (
                <span className="inline-flex min-w-0 max-w-full items-center gap-1.5" title={subject.name}>
                  <span aria-hidden className="subj-dot h-2 w-2 flex-none rounded-full" />
                  {/* The code where there is one: short, and the dot already says which subject. */}
                  <span className="truncate font-medium">{subject.code || subject.name}</span>
                  {subject.code && <span className="sr-only">{subject.name}</span>}
                </span>
              )}
              {when && <span className="sm:hidden">{when}</span>}
              {marks > 0 && <span className="sm:hidden">{marks} marks</span>}
            </p>
          </div>
          <span className="hidden w-24 shrink-0 sm:block">
            <Badge tone={hot ? "accent" : "neutral"}>{count}× asked</Badge>
          </span>
          {hasMarks && (
            <span className="hidden w-16 shrink-0 text-center text-[14px] font-semibold tabular-nums text-text sm:block">
              {marks > 0 ? marks : <span className="font-normal text-faint">—</span>}
            </span>
          )}
          {/* The Revise button below lands over this cell; the years give way to it rather than show through. */}
          <span
            className={cn(
              "hidden w-28 shrink-0 pl-3 transition-opacity duration-150 sm:block",
              "pointer-fine:group-hover:opacity-0 group-focus-within:opacity-0",
              selected && "opacity-0",
            )}
          >
            {when ? <Badge>{when}</Badge> : <span className="text-[13px] text-faint">—</span>}
          </span>
          {!wide && (
            <ChevronDown
              size={16}
              aria-hidden
              className={cn("w-4 shrink-0 transition-[transform,color] duration-200 ease-snappy", open ? "rotate-180 text-text" : "text-muted group-hover:text-text")}
            />
          )}
        </button>
        {/* Floats over the row's right end rather than holding a column, so the topic keeps the width. Shown on
            mouse hover, on keyboard focus anywhere in the row, and on the picked row, whose years the panel beside
            repeats. On touch, a tap opens the row (or picks it) and its own "Open in PYQs" link. */}
        <Link
          href={pyqsHref(stat)}
          aria-label={`Revise ${topic.title} in ${subject.name} PYQs`}
          className={buttonClass(
            "secondary",
            "sm",
            cn(
              "pointer-events-none absolute top-1/2 hidden -translate-y-1/2 gap-0.5 text-accent opacity-0 sm:inline-flex",
              "pointer-fine:group-hover:pointer-events-auto pointer-fine:group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100",
              wide ? "right-5" : "right-11",
              selected && "pointer-events-auto opacity-100",
            ),
          )}
        >
          Revise <ChevronRight size={14} aria-hidden />
        </Link>
      </div>
      {expanded && (
        // Inset under the row, lined up with the topic title from sm (phones keep the width for the question text).
        <div id={panelId} className="tab-in border-t border-border bg-surface-2/40 px-4 pb-4 sm:pl-[3.75rem] sm:pr-5">
          <ul className="divide-y divide-border">
            {stat.questions.map((q) => <QuestionLine key={q.id} q={q} />)}
          </ul>
          <ReviseLink stat={stat} />
        </div>
      )}
    </li>
  );
}

function ReviseLink({ stat }: { stat: ImportantTopic }) {
  return (
    <Link href={pyqsHref(stat)} className="group mt-2.5 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
      Open in {stat.subject.name} PYQs{" "}
      <ChevronRight size={14} aria-hidden className="transition-transform duration-200 ease-snappy group-hover:translate-x-0.5" />
    </Link>
  );
}

/** Side by side: the chosen topic's past-paper questions, kept in view while the list scrolls. */
function Detail({ stat, animate }: { stat: ImportantTopic; animate: boolean }) {
  const { topic, subject, count, marks, years } = stat;
  const when = span(years);
  return (
    <Panel className="sticky top-6">
      {/* Keyed by topic: picking another row swaps the panel in with a short settle (not on first load), and its
          questions start again from the top. */}
      <div
        key={topic.id}
        aria-label={`Questions on ${topic.title}`}
        role="region"
        style={subjectStyle(subject.color)}
        className={cn("flex max-h-[calc(100dvh-3rem)] flex-col", animate && "tab-in")}
      >
        <header className="border-b border-border px-5 py-4">
          <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-muted">
            <span aria-hidden className="subj-dot h-2 w-2 flex-none rounded-full" />
            <span className="truncate">{subject.code ? `${subject.code} · ${subject.name}` : subject.name}</span>
          </p>
          <h2 className="mt-1.5 text-[16px] font-semibold leading-snug tracking-[-0.01em]">{topic.title}</h2>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={stat.hot ? "accent" : "neutral"}>{count}× asked</Badge>
            {marks > 0 && <Badge>{marks} marks</Badge>}
            {when && <Badge>{when}</Badge>}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          <ul className="divide-y divide-border">
            {stat.questions.map((q) => <QuestionLine key={q.id} q={q} />)}
          </ul>
          <ReviseLink stat={stat} />
        </div>
      </div>
    </Panel>
  );
}
