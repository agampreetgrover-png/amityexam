"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState, type ReactNode } from "react";
import { WifiOff } from "lucide-react";
import { db } from "@/lib/db";
import type { ExamMode, Material, Subject, Topic, Unit } from "@/lib/types";
import { Select } from "../ui";

/** All uploaded materials for a subject (undefined while loading, so it isn't mistaken for none). */
export function useMaterials(subjectId: number): Material[] | undefined {
  return useLiveQuery(() => db.materials.where({ subjectId }).toArray(), [subjectId]);
}

/** Study material texts, excluding past papers (those only feed predictions and chat). */
export const noteTexts = (materials: Material[]) => materials.filter((m) => m.kind !== "pyq").map((m) => m.text);

// Mirrors the request limits in AiRequestSchema so big subjects don't get a 400.
const MAX_TOPICS = 150;
export const MAX_CONTEXT = 400_000;
export const MAX_TEXT = 100_000;
const MAX_TITLE = 300;
/** Each field of a written answer sent for marking: the question, the model answer and the student's answer. */
export const MAX_ANSWER = 5000;

/** Topic titles for an AI request, within the schema's caps (150 titles, 300 characters each). */
export const topicTitles = (topics: Pick<Topic, "title">[], max = MAX_TOPICS) => topics.slice(0, max).map((t) => t.title.slice(0, MAX_TITLE));

/** Retrieval query for a topic: its title plus its unit's title for extra keywords. */
export const topicQuery = (topic: Topic, units: Unit[]) => `${topic.title} ${units.find((u) => u.id === topic.unitId)?.title ?? ""}`;

/** Tracks navigator.onLine so AI buttons can be disabled offline. */
export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** Props every tab receives from the subject page. */
export interface TabProps {
  subject: Subject;
  /** The current mode's own syllabus; units added in a tab are tagged with `mode`. */
  units: Unit[];
  topics: Topic[];
  mode: ExamMode;
}

/** Topic picker grouped by unit; value "" means the whole subject. */
export function TopicSelect({
  units, topics, value, onChange, allLabel = "Whole subject", className, label,
}: {
  units: Unit[];
  topics: Topic[];
  value: string;
  onChange: (v: string) => void;
  allLabel?: string;
  className?: string;
  /** Names the picker when it isn't inside a <Field>, whose label already does. */
  label?: string;
}) {
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">{allLabel}</option>
      {units.map((u) => (
        <optgroup key={u.id} label={u.title}>
          {topics.filter((t) => t.unitId === u.id).map((t) => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

export const OfflineHint = ({ online, children }: { online: boolean; children?: ReactNode }) =>
  online ? null : (
    <p className="flex items-start gap-2.5 rounded-md border border-accent/20 bg-accent-soft px-4 py-3 text-sm text-text">
      <WifiOff size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
      <span>{children ?? <>You&apos;re offline. AI features are paused until you reconnect.</>}</span>
    </p>
  );

export const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
