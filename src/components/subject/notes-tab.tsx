"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { aiModeFields, modeShort } from "@/lib/mode";
import { retrieve } from "@/lib/retrieve";
import type { GeneratedDoc } from "@/lib/types";
import { AiErrorBox } from "../ai-error";
import { Badge, Button, Card, Empty, Field, Section, Select, cn } from "../ui";
import { DocList, DocViewer, DraftCard, saveDoc, StopButton, useStreamDoc } from "./docs";
import { MAX_CONTEXT, noteTexts, OfflineHint, topicQuery, TopicSelect, topicTitles, useMaterials, useOnline, type TabProps } from "./shared";

type NoteKind = "summary" | "cheatsheet";

export function NotesTab({ subject, units, topics, mode }: TabProps) {
  const subjectId = subject.id!;
  const online = useOnline();
  const [topicId, setTopicId] = useState("");
  const [kind, setKind] = useState<NoteKind>("summary");
  const [viewing, setViewing] = useState<GeneratedDoc | null>(null);
  const [filter, setFilter] = useState("all");
  const gen = useStreamDoc();
  const [ready, setReady] = useState("");
  // What the doc being written will be saved as, so a stopped draft can still be saved under the right name.
  const [pending, setPending] = useState<Pick<GeneratedDoc, "topicId" | "kind" | "title"> | null>(null);

  const materials = useMaterials(subjectId);
  const docs =
    useLiveQuery(
      () => db.docs.where({ subjectId }).filter((d) => d.kind === "summary" || d.kind === "cheatsheet").reverse().sortBy("createdAt"),
      [subjectId],
    );
  const shown = filter === "all" ? docs : docs?.filter((d) => String(d.topicId ?? "") === filter);

  const generate = async () => {
    if (!materials) return; // still loading; the button waits for them
    setViewing(null);
    setReady("");
    const topic = topics.find((t) => String(t.id) === topicId);
    const texts = noteTexts(materials);
    const context = topic ? retrieve(texts, topicQuery(topic, units), 15_000) : texts.join("\n\n").slice(0, MAX_CONTEXT);
    // Topics are already the current mode's syllabus (scoped by the subject page).
    const topicNames = topicTitles(topic ? [topic] : topics);
    const label = kind === "summary" ? "Notes" : "Cheat sheet";
    const scope = !topic && mode ? ` (${modeShort(mode).toLowerCase()})` : "";
    const meta = { topicId: topic?.id, kind, title: `${label}: ${topic?.title ?? subject.name}${scope}` };
    setPending(meta);
    const content = await gen.run(kind, { subject: subject.name, topics: topicNames, context, ...aiModeFields(mode, units) });
    if (!content?.trim()) return;
    const doc = await saveDoc({ subjectId, ...meta, content });
    gen.reset();
    setViewing(doc);
    setReady(`${label} ready`);
  };

  return (
    <div className="space-y-8">
      <Card className="no-print" title="Write notes">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <Field label="Topic">
            <TopicSelect units={units} topics={topics} value={topicId} onChange={setTopicId} allLabel={mode ? `Whole ${modeShort(mode).toLowerCase()} syllabus` : undefined} />
          </Field>
          <Field label="Type">
            <Select value={kind} onChange={(e) => setKind(e.target.value as NoteKind)}>
              <option value="summary">Short notes</option>
              <option value="cheatsheet">Cheat sheet</option>
            </Select>
          </Field>
          {gen.busy ? (
            <StopButton onClick={gen.stop} />
          ) : (
            <Button onClick={generate} disabled={!online || !materials}><Sparkles size={16} /> Write notes</Button>
          )}
        </div>
        {materials?.length === 0 && <p className="mt-3 text-[13px] text-muted">No materials uploaded, so notes will come from general knowledge.</p>}
        <div className="mt-3 space-y-2"><OfflineHint online={online} /><AiErrorBox error={gen.error} /></div>
        <p role="status" className="sr-only">{gen.busy ? "Writing your notes" : ready}</p>
      </Card>

      <DraftCard
        gen={gen}
        busyTitle="Writing…"
        onSave={async () => {
          if (!pending) return;
          const doc = await saveDoc({ subjectId, ...pending, title: `${pending.title} (draft)`, content: gen.text });
          gen.reset();
          setViewing(doc);
        }}
      />

      {viewing && <DocViewer doc={viewing} onDeleted={() => setViewing(null)} onClose={() => setViewing(null)} />}

      {/* Saved notes are a plain list on the page; only the generator above is a panel. */}
      <Section
        className="no-print"
        title={docs?.length ? <span className="flex items-center gap-2">Saved notes <Badge>{docs.length}</Badge></span> : "Saved notes"}
        // The topic filter only appears once there's something to filter.
        action={!!docs?.length && (
          <TopicSelect
            units={units}
            topics={topics}
            value={filter === "all" ? "" : filter}
            onChange={(v) => setFilter(v || "all")}
            label="Filter saved notes by topic"
            allLabel="All notes"
            className={cn("h-8 w-auto max-w-[60%] text-xs pointer-coarse:h-10", filter !== "all" && "border-accent text-accent")}
          />
        )}
      >
        {!shown ? null : shown.length ? (
          // Keyed by the filter, so a new filter visibly settles the shorter or longer list in.
          <div key={filter} className="tab-in"><DocList docs={shown} selected={viewing?.id} onSelect={setViewing} /></div>
        ) : docs?.length ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 text-sm text-muted">
            <p>No saved notes for this topic yet.</p>
            <Button variant="secondary" size="sm" onClick={() => setFilter("all")}>Show all notes</Button>
          </div>
        ) : (
          // No icon card: the next step is the form right above, so this says what it makes and where it goes.
          <Empty title="Nothing saved yet">
            Pick a topic, or leave it on the whole syllabus, choose short notes or a cheat sheet, and press Write notes. Each one is saved here to read again or print.
          </Empty>
        )}
      </Section>
    </div>
  );
}
