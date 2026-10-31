"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, PenLine, Sparkles, XCircle } from "lucide-react";
import { db } from "@/lib/db";
import { retrieve } from "@/lib/retrieve";
import { refreshWeak } from "@/lib/weak";
import { AiError, aiJson } from "@/lib/ai/client";
import { aiModeFields } from "@/lib/mode";
import type { QuizAttempt, QuizQuestion } from "@/lib/types";
import { AiErrorBox } from "../ai-error";
import { Badge, Button, Card, Empty, Field, List, Panel, Progress, Section, Select, Textarea, cn } from "../ui";
import { matchOption, norm } from "./quiz-match";
import { MAX_ANSWER, noteTexts, OfflineHint, topicTitles, useMaterials, useOnline, type TabProps } from "./shared";

type Difficulty = "easy" | "medium" | "hard";
interface Graded { score: number; feedback?: string }

const scoreColor = (s: number) => (s >= 80 ? "text-good" : s >= 60 ? "text-warn" : "text-bad");
const attemptMeta = (a: QuizAttempt) =>
  `${a.questions.length} question${a.questions.length === 1 ? "" : "s"}, ${new Date(a.createdAt).toLocaleDateString()}`;

export function QuizTab({ subject, units, topics, mode }: TabProps) {
  const subjectId = subject.id!;
  const online = useOnline();
  const [picked, setPicked] = useState<number[]>([]);
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<unknown>(null);

  // Active quiz state
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [quizTopicIds, setQuizTopicIds] = useState<number[]>([]);
  const [responses, setResponses] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [graded, setGraded] = useState<Graded[] | null>(null);
  // A past attempt opened from the list, to see which answers were wrong.
  const [reviewing, setReviewing] = useState<QuizAttempt | null>(null);
  const qRef = useRef<HTMLParagraphElement>(null);

  // Moves focus to each new question so screen readers announce it, and so focus isn't lost when Next turns into Submit.
  useEffect(() => { qRef.current?.focus(); }, [page, questions]);

  const materials = useMaterials(subjectId);
  const attempts = useLiveQuery(() => db.quizzes.where({ subjectId }).reverse().sortBy("createdAt"), [subjectId]);

  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const start = async () => {
    if (!materials) return; // still loading; the button waits for them
    setBusy("Writing your quiz…");
    setError(null);
    try {
      // Topics deleted since being picked are dropped here, so the saved attempt only references real ones.
      const chosen = topics.filter((t) => picked.includes(t.id!));
      if (!chosen.length) throw new Error("Pick at least one topic.");
      const context = retrieve(noteTexts(materials), chosen.map((t) => t.title).join(" "), 12_000);
      const res = await aiJson("quiz", { subject: subject.name, topics: topicTitles(chosen), context, count, difficulty, ...aiModeFields(mode, units) });
      // MCQs need options and an answer that is one of them; otherwise grade them as short answers instead.
      // Kept to the number asked for, so marking never sends more answers than the grade request allows.
      const qs: QuizQuestion[] = res.questions
        .filter((q) => q.question.trim())
        .slice(0, count)
        .map((q) => {
          const options = [...new Set((q.options ?? []).map((o) => o.trim()).filter(Boolean))];
          const answer = q.type === "mcq" && options.length >= 2 ? matchOption(q.answer, options) : null;
          return answer ? { ...q, options, answer } : { ...q, type: "short" as const, options: undefined };
        });
      if (!qs.length) throw new Error("The AI returned no questions. Try again.");
      setQuizTopicIds(chosen.map((t) => t.id!));
      setQuestions(qs);
      setResponses(qs.map(() => ""));
      setPage(0);
      setGraded(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  };

  const submit = async () => {
    if (!questions) return;
    setBusy("Marking…");
    setError(null);
    try {
      const results: Graded[] = questions.map((q, i) =>
        q.type === "mcq" ? { score: norm(responses[i]) === norm(q.answer) ? 1 : 0 } : { score: 0 },
      );
      // Short answers: AI grading with partial credit; blank answers stay 0.
      const shortIdx = questions.map((q, i) => (q.type === "short" && responses[i].trim() ? i : -1)).filter((i) => i >= 0);
      if (shortIdx.length) {
        // Clipped to the request's limits, so one overlong model answer can't make the whole quiz unmarkable.
        const clip = (s: string) => s.slice(0, MAX_ANSWER);
        const res = await aiJson("grade", {
          answers: shortIdx.map((i) => ({ question: clip(questions[i].question), expected: clip(questions[i].answer), given: clip(responses[i]) })),
        });
        // Results are matched by position; a reply missing one would shift every later score onto the wrong answer.
        if (res.results.length !== shortIdx.length) throw new AiError("The AI marked the wrong number of answers. Submit again to re-mark.");
        shortIdx.forEach((qi, k) => {
          const r = res.results[k];
          if (r) results[qi] = { score: r.score, feedback: r.feedback };
        });
      }
      const score = Math.round((results.reduce((a, r) => a + r.score, 0) / questions.length) * 100);
      await db.quizzes.add({ subjectId, topicIds: quizTopicIds, questions, responses, score, createdAt: Date.now() });
      await refreshWeak(quizTopicIds);
      setGraded(results);
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  };

  const reset = () => { setQuestions(null); setGraded(null); setResponses([]); };

  // ---- Reviewing a past attempt
  if (reviewing && !questions) {
    return <AttemptReview attempt={reviewing} topics={topics} onBack={() => setReviewing(null)} />;
  }

  // ---- Results view
  if (questions && graded) {
    const score = Math.round((graded.reduce((a, r) => a + r.score, 0) / questions.length) * 100);
    return (
      <div className="space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold">Quiz score</h2>
            {/* Fades in once, as the answer to pressing Submit. */}
            <p className={cn("numeral count-in mt-4 text-[64px]", scoreColor(score))}>{score}%</p>
            <p className="mt-3 text-[15px] text-muted">
              {score >= 80 ? "Strong. Move on to the next topic." : score >= 60 ? "Decent. Revise the ones you missed." : "Weak area. It's been flagged for extra study."}
            </p>
            <Progress value={score} className="mt-4 max-w-sm" />
          </div>
          <Button onClick={reset}>New quiz</Button>
        </header>
        <Section title="Answers">
          <List>
            {questions.map((q, i) => {
              const g = graded[i];
              const ok = g.score >= 0.99;
              return (
                <AnswerRow
                  key={i}
                  n={i + 1}
                  q={q}
                  verdict={ok ? "correct" : g.score > 0 ? "partial" : "wrong"}
                  given={responses[i]}
                  givenTone={!ok && responses[i] && (g.score > 0 ? "text-warn" : "text-bad")}
                >
                  {!ok && (
                    <p className="break-words rounded-md border border-good/25 bg-good/5 px-3 py-2">
                      <span className="text-muted">Correct answer:</span> {q.answer}
                    </p>
                  )}
                  {q.type === "short" && <p className="text-muted">Scored <span className="tabular-nums">{Math.round(g.score * 100)}%</span>{g.feedback && `. ${g.feedback}`}</p>}
                </AnswerRow>
              );
            })}
          </List>
        </Section>
      </div>
    );
  }

  // ---- Taking the quiz
  if (questions) {
    const q = questions[page];
    const answered = responses.filter((r) => r.trim()).length;
    const blank = questions.length - answered;
    const set = (v: string) => setResponses((r) => r.map((x, i) => (i === page ? v : x)));
    // Choose-one answers are marked here; only written answers need the AI, so an all-MCQ quiz can be submitted offline.
    const needsAi = questions.some((x, i) => x.type === "short" && responses[i]?.trim());
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between text-sm text-muted tabular-nums">
          <span>Question <span className="font-semibold text-text">{page + 1}</span> of {questions.length}</span>
          <span>{answered} answered</span>
        </div>
        <Progress value={((page + 1) / questions.length) * 100} />
        <Card className="sm:p-6">
          <div className="mb-5 flex items-start justify-between gap-3">
            <p id={`q-${page}`} ref={qRef} tabIndex={-1} className="text-[18px] font-medium leading-snug outline-none">{q.question}</p>
            <Badge className="shrink-0">{q.type === "mcq" ? "Choose one" : "Short answer"}</Badge>
          </div>
          {q.type === "mcq" ? (
            <div role="radiogroup" aria-labelledby={`q-${page}`} className="space-y-2">
              {q.options!.map((o, oi) => (
                <label
                  key={oi}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 text-[15px] leading-relaxed transition-colors duration-150",
                    responses[page] === o
                      ? "border-accent bg-accent-soft font-medium text-text"
                      : "border-border bg-surface text-text hover:border-line-strong hover:bg-surface-2",
                  )}
                >
                  <input type="radio" name={`q${page}`} checked={responses[page] === o} onChange={() => set(o)} className="mt-1 accent-[var(--accent)]" />
                  {o}
                </label>
              ))}
            </div>
          ) : (
            <Textarea aria-labelledby={`q-${page}`} placeholder="Write your answer" maxLength={MAX_ANSWER} value={responses[page]} onChange={(e) => set(e.target.value)} className="min-h-32" />
          )}
        </Card>
        <AiErrorBox error={error} />
        {needsAi && page === questions.length - 1 && (
          <OfflineHint online={online}>You&apos;re offline. Written answers are marked by AI, so submit once you&apos;re back online.</OfflineHint>
        )}
        {page === questions.length - 1 && blank > 0 && (
          <p className="text-sm text-muted">{blank} question{blank === 1 ? "" : "s"} left blank. Blank answers count as wrong.</p>
        )}
        {/* Phones: Previous drops to its icon so the last page's three buttons fit on one line. */}
        <div className="flex items-center justify-between gap-2 [&>button]:whitespace-nowrap">
          <Button variant="secondary" onClick={() => setPage(page - 1)} disabled={page === 0}><ChevronLeft size={16} /><span className="max-sm:sr-only">Previous</span></Button>
          <Button variant="ghost" disabled={!!busy} onClick={() => confirm("Leave this quiz? Your answers won't be saved.") && reset()}>Leave quiz</Button>
          {page < questions.length - 1 ? (
            <Button variant="secondary" onClick={() => setPage(page + 1)}>Next <ChevronRight size={16} /></Button>
          ) : (
            <Button onClick={submit} disabled={!!busy || (needsAi && !online)}>{busy || "Submit answers"}</Button>
          )}
        </div>
      </div>
    );
  }

  // ---- Setup
  return (
    <div className="space-y-8">
      <Card title="New practice quiz">
        {topics.length === 0 ? (
          <p className="text-sm text-muted">Add topics in the Syllabus tab first.</p>
        ) : (
          // Phones list every topic in the page's own scroll; a box scrolling inside it cut chips in half.
          <div className="space-y-4 sm:max-h-72 sm:overflow-y-auto sm:pr-1">
            {units.map((u) => {
              const ts = topics.filter((t) => t.unitId === u.id);
              if (!ts.length) return null;
              const all = ts.every((t) => picked.includes(t.id!));
              return (
                <div key={u.id}>
                  <label className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 accent-[var(--accent)]"
                      checked={all}
                      onChange={() => setPicked((p) => (all ? p.filter((x) => !ts.some((t) => t.id === x)) : [...new Set([...p, ...ts.map((t) => t.id!)])]))}
                    />
                    {u.title}
                  </label>
                  <div className="flex flex-wrap gap-1.5 sm:ml-6">
                    {ts.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={picked.includes(t.id!)}
                        onClick={() => toggle(t.id!)}
                        className={cn(
                          // rounded-lg, not a pill: a long topic name wraps to two lines on a phone.
                          "inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-3 py-1 text-left text-[13px] transition-colors duration-150 pointer-coarse:min-h-10",
                          picked.includes(t.id!)
                            ? "border-accent bg-accent-soft font-medium text-accent"
                            : "border-border bg-surface text-muted hover:bg-surface-2 hover:text-text",
                        )}
                      >
                        {t.title}
                        {t.weak && <span className="text-xs font-medium text-bad">weak</span>}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-[auto_auto_1fr] sm:items-end">
          <Field label="Questions">
            <Select value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[5, 10, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Field>
          <Field label="Difficulty">
            <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </Select>
          </Field>
          <Button onClick={start} disabled={!picked.length || !!busy || !online || !materials} className="col-span-2 sm:col-span-1 sm:justify-self-end">
            <Sparkles size={16} /> {busy || (picked.length ? `Start quiz on ${picked.length} topic${picked.length === 1 ? "" : "s"}` : "Pick topics to start")}
          </Button>
        </div>
        <div className="mt-3 space-y-2 empty:hidden"><OfflineHint online={online} /><AiErrorBox error={error} /></div>
      </Card>

      <Section title="Past attempts">
        {!attempts ? null : attempts.length === 0 ? (
          <Empty icon={<ClipboardList size={18} />} title="No quizzes taken yet" />
        ) : (
          <Panel as="ul" className="divide-y divide-border">
            {attempts.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setReviewing(a)}
                  disabled={!a.questions.length}
                  aria-label={`Review the ${a.score}% quiz from ${new Date(a.createdAt).toLocaleDateString()}`}
                  className="group flex w-full items-center gap-4 px-4 py-3 text-left text-sm transition-colors duration-150 hover:bg-surface-2/60 disabled:pointer-events-none sm:px-5"
                >
                  <span className={cn("numeral w-16 shrink-0 text-[28px]", scoreColor(a.score))}>{a.score}%</span>
                  {/* Phones: the count and date go under the topics, so the topics get the row's width. */}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {a.topicIds.map((id) => topics.find((t) => t.id === id)?.title).filter(Boolean).join(", ") || <span className="text-muted">Topics removed</span>}
                    </span>
                    <span className="mt-0.5 block text-[13px] tabular-nums text-muted sm:hidden">{attemptMeta(a)}</span>
                  </span>
                  <span className="hidden shrink-0 text-[13px] tabular-nums text-muted sm:block">{attemptMeta(a)}</span>
                  {a.questions.length > 0 && <ChevronRight size={16} className="shrink-0 text-faint transition-transform duration-200 ease-snappy group-hover:translate-x-0.5 group-hover:text-muted" aria-hidden />}
                </button>
              </li>
            ))}
          </Panel>
        )}
      </Section>
    </div>
  );
}

/** A saved attempt, read back. Choose-one answers are re-marked; written answers show the model answer, since their AI feedback isn't stored. */
function AttemptReview({ attempt, topics, onBack }: { attempt: QuizAttempt; topics: TabProps["topics"]; onBack: () => void }) {
  const names = attempt.topicIds.map((id) => topics.find((t) => t.id === id)?.title).filter(Boolean).join(", ");
  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2.5"><ArrowLeft size={14} /> Back to quizzes</Button>
        <header className="border-b border-border pb-6">
          <h2 className="text-[15px] font-semibold">Quiz from {new Date(attempt.createdAt).toLocaleDateString()}</h2>
          <p className={cn("numeral mt-4 text-[64px]", scoreColor(attempt.score))}>{attempt.score}%</p>
          {names && <p className="mt-3 text-[15px] text-muted">{names}</p>}
          <Progress value={attempt.score} className="mt-4 max-w-sm" />
        </header>
      </div>
      <Section title="Answers">
        <List>
          {attempt.questions.map((q, i) => {
            const given = attempt.responses[i] ?? "";
            const mcq = q.type === "mcq";
            const ok = mcq && norm(given) === norm(q.answer);
            return (
              <AnswerRow key={i} n={i + 1} q={q} verdict={mcq ? (ok ? "correct" : "wrong") : "written"} given={given} givenTone={mcq && !ok && given && "text-bad"}>
                {!ok && (
                  <p className={cn("break-words rounded-md border px-3 py-2", mcq ? "border-good/25 bg-good/5" : "border-border bg-surface-2")}>
                    <span className="text-muted">{mcq ? "Correct answer:" : "Model answer:"}</span> {q.answer}
                  </p>
                )}
              </AnswerRow>
            );
          })}
        </List>
      </Section>
    </div>
  );
}

/** One marked question: the question and how it went, the student's answer, any correction, then the explanation. */
function AnswerRow({ n, q, verdict, given, givenTone, children }: {
  n: number;
  q: QuizQuestion;
  verdict: VerdictKind;
  given: string;
  /** Colours the student's answer when it was wrong or only partly right. */
  givenTone?: string | false;
  children?: ReactNode;
}) {
  return (
    <li className="py-4">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-[15px] font-medium leading-relaxed"><span className="tabular-nums text-muted">{n}.</span> {q.question}</p>
        <Verdict kind={verdict} />
      </div>
      <div className="mt-2 space-y-2 text-sm leading-relaxed">
        <p className={cn("break-words", givenTone)}>
          <span className="text-muted">Your answer:</span> {given || <em className="text-muted">left blank</em>}
        </p>
        {children}
        {q.explanation && <p className="text-muted">{q.explanation}</p>}
      </div>
    </li>
  );
}

type VerdictKind = "correct" | "partial" | "wrong" | "written";

/** How one answer went: a small icon plus a word, so the result never rests on colour alone. */
function Verdict({ kind }: { kind: VerdictKind }) {
  const v = {
    correct: { Icon: CheckCircle2, label: "Correct", tone: "text-good" },
    partial: { Icon: XCircle, label: "Partly correct", tone: "text-warn" },
    wrong: { Icon: XCircle, label: "Wrong", tone: "text-bad" },
    written: { Icon: PenLine, label: "Written answer", tone: "text-muted" },
  }[kind];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap pt-0.5 text-[13px] font-medium", v.tone)}>
      <v.Icon size={15} aria-hidden /> {v.label}
    </span>
  );
}
