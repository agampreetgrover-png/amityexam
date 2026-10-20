"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { db } from "@/lib/db";
import type { Material, Subject, Topic, Unit } from "@/lib/types";
import { Select } from "../ui";

/** All uploaded materials for a subject (empty while loading). */
export function useMaterials(subjectId: number): Material[] {
  return useLiveQuery(() => db.materials.where({ subjectId }).toArray(), [subjectId]) ?? [];
}

/** Study material texts, excluding past papers (those only feed predictions and chat). */
export const noteTexts = (materials: Material[]) => materials.filter((m) => m.kind !== "pyq").map((m) => m.text);

// Mirrors the request limits in AiRequestSchema so big subjects don't get a 400.
export const MAX_TOPICS = 150;
export const MAX_CONTEXT = 400_000;
export const MAX_TEXT = 100_000;

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
  units: Unit[];
  topics: Topic[];
}

/** Topic picker grouped by unit; value "" means the whole subject (when allowed). */
export function TopicSelect({
  units, topics, value, onChange, allowAll = true, className,
}: {
  units: Unit[];
  topics: Topic[];
  value: string;
  onChange: (v: string) => void;
  allowAll?: boolean;
  className?: string;
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      {allowAll ? <option value="">Whole subject</option> : <option value="" disabled>Choose a topic…</option>}
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

export const OfflineHint = ({ online }: { online: boolean }) =>
  online ? null : <p className="text-xs text-warn">You&apos;re offline. AI features are paused until you reconnect.</p>;

export const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
