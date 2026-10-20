"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Sparkles, TrendingUp } from "lucide-react";
import { db } from "@/lib/db";
import { aiModeFields, modeShort, pyqMatchesMode } from "@/lib/mode";
import type { GeneratedDoc } from "@/lib/types";
import { AiErrorBox } from "../ai-error";
import { Markdown } from "../markdown";
import { Button, Card, Empty } from "../ui";
import { DocList, DocViewer, saveDoc, StopButton, useStreamDoc } from "./docs";
import { MAX_CONTEXT, MAX_TOPICS, OfflineHint, useOnline, type TabProps } from "./shared";

export function PredictTab({ subject, units, topics, mode }: TabProps) {
  const subjectId = subject.id!;
  const online = useOnline();
  const gen = useStreamDoc();
  const [viewing, setViewing] = useState<GeneratedDoc | null>(null);

  const allPyqs = useLiveQuery(() => db.materials.where({ subjectId }).filter((m) => m.kind === "pyq").toArray(), [subjectId]) ?? [];
  // Prefer papers named for this exam (e.g. "Minor 2023" in mid-sem, "EndSem 2023" for major); else use them all.
  const matched = allPyqs.filter((p) => pyqMatchesMode(p, mode));
  const pyqs = matched.length ? matched : allPyqs;
  const docs = useLiveQuery(() => db.docs.where({ subjectId }).filter((d) => d.kind === "predict").reverse().sortBy("createdAt"), [subjectId]) ?? [];

  const generate = async () => {
    setViewing(null);
    // Label each paper so the model can count repeats across years.
    const context = pyqs.map((p) => `=== ${p.fileName} ===\n${p.text}`).join("\n\n").slice(0, MAX_CONTEXT);
    const content = await gen.run("predict", { subject: subject.name, topics: topics.slice(0, MAX_TOPICS).map((t) => t.title), context, ...aiModeFields(mode, units) });
    if (!content?.trim()) return;
    const doc = await saveDoc({
      subjectId, kind: "predict", content,
      title: `Prediction: ${subject.name}${mode ? `, ${modeShort(mode).toLowerCase()}` : ""} (${pyqs.length} paper${pyqs.length === 1 ? "" : "s"})`,
    });
    gen.reset();
    setViewing(doc);
  };

  return (
    <div className="space-y-6">
      <Card className="no-print" title="Predict exam questions">
        <p className="max-w-prose text-[15px] leading-relaxed">
          Compares your previous year papers with the syllabus to find repeated questions, how marks are usually split, and the questions most likely to come up.
        </p>
        <p className="mt-2 max-w-prose text-xs leading-relaxed text-muted">
          {pyqs.length
            ? `Using ${pyqs.length} ${matched.length && mode ? `${modeShort(mode).toLowerCase()} ` : ""}paper${pyqs.length === 1 ? "" : "s"}: ${pyqs.map((p) => p.fileName).join(", ")}${
                matched.length && matched.length < allPyqs.length ? ` (${allPyqs.length - matched.length} other paper${allPyqs.length - matched.length === 1 ? "" : "s"} skipped)` : ""
              }`
            : "No previous year papers yet. Add them in Materials as “Previous year paper” for much better predictions. Without them, only the syllabus is used."}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          {gen.busy ? <StopButton onClick={gen.stop} /> : (
            <Button onClick={generate} disabled={!online || (!pyqs.length && !topics.length)}><Sparkles size={16} /> Predict questions</Button>
          )}
        </div>
        <div className="mt-2 space-y-2"><OfflineHint online={online} /><AiErrorBox error={gen.error} /></div>
      </Card>

      {(gen.busy || gen.text) && (
        <Card title={gen.busy ? "Reading the papers…" : "Draft"} className="no-print"><Markdown>{gen.text || "…"}</Markdown></Card>
      )}

      {viewing && <DocViewer doc={viewing} onDeleted={() => setViewing(null)} />}

      <Card className="no-print" title="Past predictions">
        {docs.length ? <DocList docs={docs} selected={viewing?.id} onSelect={setViewing} /> : <Empty icon={<TrendingUp />} title="No predictions yet" />}
      </Card>
    </div>
  );
}
