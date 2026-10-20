"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Cloud, ExternalLink, Eye, FileText, Plus, Trash2, Upload } from "lucide-react";
import { db } from "@/lib/db";
import { modeShort } from "@/lib/mode";
import { extractAny } from "@/lib/pdf";
import type { Material, MaterialKind } from "@/lib/types";
import { AiErrorBox } from "../ai-error";
import { Badge, Button, Card, Empty, Field, Input, List, Modal, Section, Select, Textarea } from "../ui";
import type { TabProps } from "./shared";

const KINDS: { value: MaterialKind; label: string }[] = [
  { value: "notes", label: "Notes" },
  { value: "pyq", label: "Previous year paper" },
  { value: "syllabus", label: "Syllabus" },
  { value: "other", label: "Other" },
];

export function MaterialsTab({ subject }: TabProps) {
  const subjectId = subject.id!;
  const materials = useLiveQuery(() => db.materials.where({ subjectId }).reverse().sortBy("createdAt"), [subjectId]) ?? [];
  const [kind, setKind] = useState<MaterialKind>("notes");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [preview, setPreview] = useState<Material | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const failed: string[] = [];
    for (const f of Array.from(files)) {
      setBusy(`Reading ${f.name}…`);
      try {
        const text = await extractAny(f, { onStatus: (s) => setBusy(`${f.name}: ${s}`) });
        await db.materials.add({ subjectId, kind, fileName: f.name, text, createdAt: Date.now() });
      } catch (e) {
        failed.push(`${f.name}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    setBusy("");
    if (failed.length) setError(new Error(failed.join("\n")));
  };

  return (
    <div className="space-y-8">
      <Card>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Type">
            <Select value={kind} onChange={(e) => setKind(e.target.value as MaterialKind)} className="w-48">
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </Select>
          </Field>
          <label className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink hover:opacity-90 focus-within:outline-2 focus-within:outline-text">
            <Upload size={16} /> Upload files
            <input
              type="file"
              multiple
              accept="application/pdf,.txt,.md,image/*"
              className="sr-only"
              disabled={!!busy}
              onChange={(e) => { upload(e.target.files); e.target.value = ""; }}
            />
          </label>
          <Button variant="secondary" onClick={() => setPasteOpen(true)}><Plus size={16} /> Paste text</Button>
        </div>
        <p className="mt-3 max-w-prose text-xs leading-relaxed text-muted">
          PDFs are read in your browser and only the text is kept. Scanned PDFs and photos of notes are transcribed by AI. Upload past papers as
          &ldquo;Previous year paper&rdquo; to use them for predictions.
        </p>
        {busy && <p className="mt-2 text-sm font-medium">{busy}</p>}
        <div className="mt-2"><AiErrorBox error={error} /></div>
      </Card>

      {materials.length === 0 ? (
        <Empty icon={<FileText />} title="No material yet">
          Notes, slides and past papers from your Google Drive folders appear here automatically after a sync (Settings → Google Drive). You can also upload your own.
          Every AI tool for this subject uses them.
        </Empty>
      ) : (
        <Section title={`${materials.length} file${materials.length === 1 ? "" : "s"}`}>
          <List>
            {materials.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-3">
                {m.source ? (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent" title="Synced from Google Drive">
                    <Cloud size={16} />
                  </span>
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center"><FileText size={18} className="text-muted" /></span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">{m.fileName}</p>
                  <p className="flex flex-wrap gap-x-3 text-xs text-muted">
                    {m.source && <span className="truncate">Drive{m.source.path.length ? ` · ${m.source.path.at(-1)}` : ""}{m.source.ocr ? " · read by AI" : ""}</span>}
                    <span>{m.text.length.toLocaleString()} characters</span>
                    <span>{new Date(m.createdAt).toLocaleDateString()}</span>
                  </p>
                </div>
                {m.pyqExam && <Badge className="bg-accent-soft text-accent">{modeShort(m.pyqExam)}</Badge>}
                <Badge className="hidden sm:inline-flex">{m.source?.format === "ppt" ? "Slides" : KINDS.find((k) => k.value === m.kind)?.label ?? m.kind}</Badge>
                {m.source && (
                  <a
                    href={m.source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open in Google Drive"
                    className="inline-flex h-8 items-center justify-center rounded-lg px-2.5 text-muted hover:bg-surface-2 hover:text-text"
                  >
                    <ExternalLink size={14} />
                  </a>
                )}
                <Button variant="ghost" size="sm" onClick={() => setPreview(m)} aria-label="Preview"><Eye size={14} /></Button>
                <Button
                  variant="danger"
                  size="sm"
                  aria-label="Delete"
                  onClick={() => confirm(`Delete "${m.fileName}"?`) && db.materials.delete(m.id!)}
                >
                  <Trash2 size={14} />
                </Button>
              </li>
            ))}
          </List>
        </Section>
      )}

      <Modal open={pasteOpen} onClose={() => setPasteOpen(false)} title="Paste material">
        <PasteForm subjectId={subjectId} defaultKind={kind} onDone={() => setPasteOpen(false)} />
      </Modal>
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.fileName ?? ""}>
        <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed">{preview?.text}</pre>
      </Modal>
    </div>
  );
}

function PasteForm({ subjectId, defaultKind, onDone }: { subjectId: number; defaultKind: MaterialKind; onDone: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState(defaultKind);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (saving || !text.trim()) return;
        setSaving(true);
        try {
          await db.materials.add({ subjectId, kind, fileName: name.trim() || "Pasted notes", text: text.trim(), createdAt: Date.now() });
          onDone();
        } catch {
          setSaving(false);
        }
      }}
    >
      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Unit 2 class notes" /></Field>
      <Field label="Type">
        <Select value={kind} onChange={(e) => setKind(e.target.value as MaterialKind)}>
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </Select>
      </Field>
      <Field label="Text"><Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-56 text-xs" /></Field>
      <div className="flex justify-end"><Button type="submit" disabled={saving || !text.trim()}>Save material</Button></div>
    </form>
  );
}
