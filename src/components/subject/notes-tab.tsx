"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { FileText, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { retrieve } from "@/lib/retrieve";
import type { GeneratedDoc } from "@/lib/types";
import { AiErrorBox } from "../ai-error";
import { Markdown } from "../markdown";
import { Button, Card, Empty, Field, Section, Select } from "../ui";
import { DocList, DocViewer, saveDoc, StopButton, useStreamDoc } from "./docs";
import { MAX_CONTEXT, MAX_TOPICS, noteTexts, OfflineHint, topicQuery, TopicSelect, useMaterials, useOnline, type TabProps } from "./shared";

type NoteKind = "summary" | "cheatsheet";

export function NotesTab({ subject, units, topics }: TabProps) {
  const subjectId = subject.id!;
  const online = useOnline();
  const [topicId, setTopicId] = useState("");
  const [kind, setKind] = useState<NoteKind>("summary");
  const [viewing, setViewing] = useState<GeneratedDoc | null>(null);
  const [filter, setFilter] = useState("all");
  const gen = useStreamDoc();

  const materials = useMaterials(subjectId);
  const docs =
    useLiveQuery(
      () => db.docs.where({ subjectId }).filter((d) => d.kind === "summary" || d.kind === "cheatsheet").reverse().sortBy("createdAt"),
      [subjectId],
    ) ?? [];
  const shown = filter === "all" ? docs : docs.filter((d) => String(d.topicId ?? "") === filter);

  const generate = async () => {
    setViewing(null);
    const topic = topics.find((t) => String(t.id) === topicId);
    const texts = noteTexts(materials);
    const context = topic ? retrieve(texts, topicQuery(topic, units), 15_000) : texts.join("\n\n").slice(0, MAX_CONTEXT);
    const topicNames = topic ? [topic.title] : topics.slice(0, MAX_TOPICS).map((t) => t.title);
    const content = await gen.run(kind, { subject: subject.name, topics: topicNames, context });
    if (!content?.trim()) return;
    const label = kind === "summary" ? "Notes" : "Cheat sheet";
    const doc = await saveDoc({ subjectId, topicId: topic?.id, kind, content, title: `${label}: ${topic?.title ?? subject.name}` });
    gen.reset();
    setViewing(doc);
  };

  return (
    <div className="space-y-8">
      <Card className="no-print">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <Field label="Topic"><TopicSelect units={units} topics={topics} value={topicId} onChange={setTopicId} /></Field>
          <Field label="Type">
            <Select value={kind} onChange={(e) => setKind(e.target.value as NoteKind)}>
              <option value="summary">Short notes</option>
              <option value="cheatsheet">Cheat sheet</option>
            </Select>
          </Field>
          {gen.busy ? (
            <StopButton onClick={gen.stop} />
          ) : (
            <Button onClick={generate} disabled={!online}><Sparkles size={16} /> Write notes</Button>
          )}
        </div>
        {!materials.length && <p className="mt-3 text-xs text-muted">No materials uploaded, so notes will come from general knowledge.</p>}
        <div className="mt-2 space-y-2"><OfflineHint online={online} /><AiErrorBox error={gen.error} /></div>
      </Card>

      {(gen.busy || gen.text) && (
        <Card title={gen.busy ? "Writing…" : "Draft"} className="no-print">
          <Markdown>{gen.text || "…"}</Markdown>
        </Card>
      )}

      {viewing && <DocViewer doc={viewing} onDeleted={() => setViewing(null)} />}

      <Section
        className="no-print"
        title="Saved notes"
        action={<TopicSelect units={units} topics={topics} value={filter === "all" ? "" : filter} onChange={(v) => setFilter(v || "all")} className="h-8 w-auto max-w-[60%] text-xs" />}
      >
        {shown.length ? (
          <DocList docs={shown} selected={viewing?.id} onSelect={setViewing} />
        ) : (
          <Empty icon={<FileText />} title="Nothing saved yet">Write short notes or a cheat sheet above.</Empty>
        )}
      </Section>
    </div>
  );
}
