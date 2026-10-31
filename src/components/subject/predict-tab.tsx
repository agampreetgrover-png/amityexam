"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Sparkles, TrendingUp } from "lucide-react";
import { db } from "@/lib/db";
import { aiModeFields, modeShort, pyqMatchesMode } from "@/lib/mode";
import type { GeneratedDoc } from "@/lib/types";
import { AiErrorBox } from "../ai-error";
import { Button, Empty, Section } from "../ui";
import { DocList, DocViewer, DraftCard, saveDoc, StopButton, useStreamDoc } from "./docs";
import { MAX_CONTEXT, OfflineHint, topicTitles, useOnline, type TabProps } from "./shared";

export function PredictTab({ subject, units, topics, mode }: TabProps) {
  const subjectId = subject.id!;
  const online = useOnline();
  const gen = useStreamDoc();
  const [ready, setReady] = useState("");
  const [viewing, setViewing] = useState<GeneratedDoc | null>(null);
  const [pendingTitle, setPendingTitle] = useState("");

  // Undefined while loading, so a tap before the papers arrive can't save a "(0 papers)" prediction.
  const allPyqs = useLiveQuery(() => db.materials.where({ subjectId }).filter((m) => m.kind === "pyq").toArray(), [subjectId]);
  // Only this exam's papers: never mid-sem papers for a major prediction or the other way round,
  // and never papers whose exam is unknown.
  const pyqs = allPyqs?.filter((p) => pyqMatchesMode(p, mode)) ?? [];
  const skipped = (allPyqs?.length ?? 0) - pyqs.length;
  const docs = useLiveQuery(() => db.docs.where({ subjectId }).filter((d) => d.kind === "predict").reverse().sortBy("createdAt"), [subjectId]);

  const generate = async () => {
    if (!allPyqs) return;
    setViewing(null);
    setReady("");
    // Label each paper so the model can count repeats across years.
    const context = pyqs.map((p) => `=== ${p.fileName} ===\n${p.text}`).join("\n\n").slice(0, MAX_CONTEXT);
    const title = `Prediction: ${subject.name}${mode ? `, ${modeShort(mode).toLowerCase()}` : ""} (${pyqs.length} paper${pyqs.length === 1 ? "" : "s"})`;
    setPendingTitle(title);
    const content = await gen.run("predict", { subject: subject.name, topics: topicTitles(topics), context: context || undefined, ...aiModeFields(mode, units) });
    if (!content?.trim()) return;
    const doc = await saveDoc({ subjectId, kind: "predict", content, title });
    gen.reset();
    setViewing(doc);
    setReady("Prediction ready");
  };

  return (
    <div className="space-y-8">
      <Section className="no-print" title="Predict exam questions">
        <p className="max-w-prose text-[15px] leading-relaxed text-text">
          Compares your previous year papers with the syllabus to find repeated questions, how marks are usually split, and the questions most likely to come up.
        </p>
        <p className="mt-3 max-w-prose break-words text-[13px] leading-relaxed text-muted tabular-nums">
          {!allPyqs ? null : pyqs.length
            ? `Using ${pyqs.length} ${modeShort(mode).toLowerCase()} paper${pyqs.length === 1 ? "" : "s"}: ${pyqs.map((p) => p.fileName).join(", ")}${
                skipped ? ` (${skipped} other paper${skipped === 1 ? "" : "s"} not for this exam, or of unknown type, left out)` : ""
              }`
            : `No ${modeShort(mode).toLowerCase()} papers yet. Sync Drive or upload some in Materials as “Previous year paper”. ${
                topics.length ? "Until then, predictions use only the syllabus." : "Add this exam's syllabus or a past paper to predict questions."
              }${
                skipped ? ` (${skipped} paper${skipped === 1 ? " is" : "s are"} for the other exam or of unknown type.)` : ""
              }`}
        </p>
        <div className="mt-5 flex gap-2">
          {gen.busy ? <StopButton onClick={gen.stop} /> : (
            <Button onClick={generate} disabled={!online || !allPyqs || (!pyqs.length && !topics.length)}><Sparkles size={16} /> Predict questions</Button>
          )}
        </div>
        <div className="mt-4 max-w-prose space-y-2 empty:hidden"><OfflineHint online={online} /><AiErrorBox error={gen.error} /></div>
        <p role="status" className="sr-only">{gen.busy ? "Writing your prediction" : ready}</p>
      </Section>

      <DraftCard
        gen={gen}
        busyTitle="Reading the papers…"
        onSave={async () => {
          const doc = await saveDoc({ subjectId, kind: "predict", content: gen.text, title: `${pendingTitle || `Prediction: ${subject.name}`} (draft)` });
          gen.reset();
          setViewing(doc);
        }}
      />

      {viewing && <DocViewer doc={viewing} onDeleted={() => setViewing(null)} />}

      {/* Past predictions are a plain list on the page, under the generator. */}
      <Section className="no-print" title="Past predictions">
        {!docs ? null : docs.length ? <DocList docs={docs} selected={viewing?.id} onSelect={setViewing} /> : <Empty icon={<TrendingUp size={18} />} title="No predictions yet" />}
      </Section>
    </div>
  );
}
