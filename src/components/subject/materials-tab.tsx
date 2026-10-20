"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Cloud, ExternalLink, Eye, FileText, Plus, Trash2, Upload } from "lucide-react";
import { db, deleteMaterial } from "@/lib/db";
import { MODES, modeShort, pyqMode } from "@/lib/mode";
import { extractAny } from "@/lib/pdf";
import { analyseSubject, setPaperExam } from "@/lib/pyq/analyse";
import type { ExamMode, Material, MaterialKind } from "@/lib/types";
import { AiErrorBox } from "../ai-error";
import { Button, Card, Empty, Field, Input, List, Modal, Section, Select, Textarea } from "../ui";
import type { TabProps } from "./shared";

const KINDS: { value: MaterialKind; label: string }[] = [
  { value: "notes", label: "Notes" },
  { value: "pyq", label: "Previous year paper" },
  { value: "syllabus", label: "Syllabus" },
  { value: "other", label: "Other" },
];

const PREVIEW_CHARS = 50_000;

/** Which exam a past paper was for. Without it, a paper whose name doesn't say is hidden from both modes. */
function ExamSelect({ value, onChange, className, label = "Which exam" }: { value: ExamMode | undefined; onChange: (m: ExamMode) => void; className?: string; label?: string }) {
  return (
    <Select value={value ?? ""} onChange={(e) => e.target.value && onChange(e.target.value as ExamMode)} className={className} aria-label={label}>
      {!value && <option value="">Exam unknown</option>}
      {MODES.map((m) => <option key={m} value={m}>{modeShort(m)}</option>)}
    </Select>
  );
}

interface PasteDraft { name: string; kind: MaterialKind; exam: ExamMode; text: string }

export function MaterialsTab({ subject, mode }: TabProps) {
  const subjectId = subject.id!;
  const materials = useLiveQuery(() => db.materials.where({ subjectId }).reverse().sortBy("createdAt"), [subjectId]) ?? [];
  const [kind, setKind] = useState<MaterialKind>("notes");
  const [exam, setExam] = useState<ExamMode>(mode);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  // Held here, not in the dialog (its content unmounts on close), so an accidental Esc doesn't lose pasted pages.
  const [paste, setPaste] = useState<PasteDraft | null>(null);
  const [preview, setPreview] = useState<Material | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const failed: string[] = [];
    for (const f of Array.from(files)) {
      setBusy(`Reading ${f.name}…`);
      try {
        const text = await extractAny(f, { onStatus: (s) => setBusy(`${f.name}: ${s}`) });
        await db.materials.add({ subjectId, kind, fileName: f.name, text, createdAt: Date.now(), ...(kind === "pyq" ? { pyqExam: exam } : {}) });
      } catch (e) {
        failed.push(`${f.name}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
    setBusy("");
    if (failed.length) setError(new Error(failed.join("\n")));
    // New past papers get split into questions for the PYQs tab.
    if (kind === "pyq" && failed.length < files.length) analyseSubject(subjectId);
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
          {kind === "pyq" && (
            <Field label="Which exam">
              <ExamSelect value={exam} onChange={setExam} className="w-36" />
            </Field>
          )}
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
          <Button
            variant="secondary"
            onClick={() => { setPaste((p) => p ?? { name: "", kind, exam, text: "" }); setPasteOpen(true); }}
          >
            <Plus size={16} /> Paste text
          </Button>
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
              <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 sm:flex-nowrap">
                {m.source ? (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent" title="Synced from Google Drive">
                    <Cloud size={16} />
                  </span>
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center"><FileText size={18} className="text-muted" /></span>
                )}
                {/* On phones the name gets the whole first line; the controls wrap underneath. */}
                <div className="min-w-0 flex-1 basis-[calc(100%-2.75rem)] sm:basis-auto">
                  <p className="truncate text-[15px] font-medium">{m.fileName}</p>
                  <p className="flex flex-wrap gap-x-3 text-xs text-muted">
                    {m.source && <span className="truncate">Drive{m.source.path?.length ? ` · ${m.source.path.at(-1)}` : ""}{m.source.ocr ? " · read by AI" : ""}</span>}
                    <span>{m.text.length.toLocaleString()} characters</span>
                    <span>{new Date(m.createdAt).toLocaleDateString()}</span>
                  </p>
                </div>
                {/* Type (and, for past papers, which exam) can be fixed after upload instead of deleting and re-uploading. */}
                <div className="ml-11 flex flex-wrap items-center gap-1 sm:ml-0 sm:shrink-0 sm:flex-nowrap">
                  <Select
                    value={m.kind}
                    aria-label={`Type of ${m.fileName}`}
                    className="h-8 w-auto py-0 text-xs"
                    onChange={async (e) => {
                      const next = e.target.value as MaterialKind;
                      await db.materials.update(m.id!, next === "pyq" && !m.pyqExam ? { kind: next, pyqExam: mode } : { kind: next });
                      if (next === "pyq") analyseSubject(subjectId);
                    }}
                  >
                    {KINDS.map((k) => <option key={k.value} value={k.value}>{k.value === "notes" && m.source?.format === "ppt" ? "Slides" : k.label}</option>)}
                  </Select>
                  {m.kind === "pyq" && (
                    <ExamSelect
                      value={pyqMode(m)}
                      label={`Which exam ${m.fileName} was for`}
                      className="h-8 w-auto py-0 text-xs"
                      onChange={(e) => setPaperExam(m.id!, e)}
                    />
                  )}
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
                  onClick={() => confirm(`Delete "${m.fileName}"?`) && deleteMaterial(m.id!)}
                >
                  <Trash2 size={14} />
                </Button>
                </div>
              </li>
            ))}
          </List>
        </Section>
      )}

      <Modal open={pasteOpen} onClose={() => setPasteOpen(false)} title="Paste material">
        {paste && (
          <PasteForm
            subjectId={subjectId}
            draft={paste}
            onChange={setPaste}
            onDone={() => { setPasteOpen(false); setPaste(null); }}
          />
        )}
      </Modal>
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.fileName ?? ""}>
        {/* A synced textbook can be 400K characters; rendering all of it freezes the page. */}
        <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed">{preview?.text.slice(0, PREVIEW_CHARS)}</pre>
        {preview && preview.text.length > PREVIEW_CHARS && (
          <p className="mt-3 text-xs text-muted">Showing the first {PREVIEW_CHARS.toLocaleString()} of {preview.text.length.toLocaleString()} characters. The AI tools use all of it.</p>
        )}
      </Modal>
    </div>
  );
}

function PasteForm({ subjectId, draft, onChange, onDone }: {
  subjectId: number;
  draft: PasteDraft;
  onChange: (d: PasteDraft) => void;
  onDone: () => void;
}) {
  const { name, kind, exam, text } = draft;
  const set = (patch: Partial<PasteDraft>) => onChange({ ...draft, ...patch });
  const [saving, setSaving] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (saving || !text.trim()) return;
        setSaving(true);
        try {
          await db.materials.add({
            subjectId, kind, fileName: name.trim() || "Pasted notes", text: text.trim(), createdAt: Date.now(),
            ...(kind === "pyq" ? { pyqExam: exam } : {}),
          });
          if (kind === "pyq") analyseSubject(subjectId);
          onDone();
        } catch {
          setSaving(false);
        }
      }}
    >
      <Field label="Name"><Input value={name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Unit 2 class notes" /></Field>
      <Field label="Type">
        <Select value={kind} onChange={(e) => set({ kind: e.target.value as MaterialKind })}>
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </Select>
      </Field>
      {kind === "pyq" && (
        <Field label="Which exam"><ExamSelect value={exam} onChange={(m) => set({ exam: m })} /></Field>
      )}
      <Field label="Text"><Textarea value={text} onChange={(e) => set({ text: e.target.value })} className="min-h-56 text-xs" /></Field>
      <div className="flex justify-end"><Button type="submit" disabled={saving || !text.trim()}>Save material</Button></div>
    </form>
  );
}
