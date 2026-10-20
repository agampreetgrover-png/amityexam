import type { Exam, StudySession, Subject, Topic, Unit } from "@/lib/types";

/** Id → record maps the planner views share to label sessions. */
export interface Lookup {
  subjects: Map<number, Subject>;
  topics: Map<number, Topic>;
  units: Map<number, Unit>;
  exams: Map<number, Exam>;
}

export function makeLookup(subjects: Subject[], topics: Topic[], units: Unit[], exams: Exam[]): Lookup {
  return {
    subjects: new Map(subjects.map((s) => [s.id!, s])),
    topics: new Map(topics.map((t) => [t.id!, t])),
    units: new Map(units.map((u) => [u.id!, u])),
    exams: new Map(exams.map((e) => [e.id!, e])),
  };
}

export function describeSession(s: StudySession, l: Lookup) {
  if (s.kind === "revision") {
    const exam = s.examId != null ? l.exams.get(s.examId) : undefined;
    const subject = exam ? l.subjects.get(exam.subjectId) : undefined;
    return { title: `Revision: ${subject?.name ?? "exam"}`, sub: exam ? `${exam.type} exam` : "", subject };
  }
  const topic = s.topicId != null ? l.topics.get(s.topicId) : undefined;
  const subject = topic ? l.subjects.get(topic.subjectId) : undefined;
  const unit = topic ? l.units.get(topic.unitId) : undefined;
  return {
    title: topic?.title ?? "Deleted topic",
    sub: [subject?.name, unit?.title].filter(Boolean).join(" · "),
    subject,
  };
}
