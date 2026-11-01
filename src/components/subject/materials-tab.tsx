"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import Link from "next/link";
import { Cloud, ExternalLink, Eye, FileText, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { db, deleteMaterial } from "@/lib/db";
import { MODES, modeShort, pyqMode } from "@/lib/mode";
import { extractAny } from "@/lib/pdf";
import { analyseSubject, setPaperExam } from "@/lib/pyq/analyse";
import type { ExamMode, Material, MaterialKind } from "@/lib/types";
import { AiErrorBox } from "../ai-error";
import { Badge, Button, Card, Empty, Field, Input, Modal, Panel, Section, Select, Textarea, cn } from "../ui";
import { isDriveUrl, type TabProps } from "./shared";

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
  const materials = useLiveQuery(() => db.materials.where({ subjectId }).reverse().sortBy("createdAt"), [subjectId]);
  const [kind, setKind] = useState<MaterialKind>("notes");
  const [exam, setExam] = useState<ExamMode>(mode);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  // Held here, not in the dialog (its content unmounts on close), so an accidental Esc doesn't lose pasted pages.
  const [paste, setPaste] = useState<PasteDraft | null>(null);
  const [preview, setPreview] = useState<Material | null>(null);

  // Takes a copy, not the input's live FileList: the input is cleared straight after the call so the same file
  // can be picked again, and that empties the live list before the loop below has finished.
  const upload = async (files: File[]) => {
    if (!files.length) return;
    setError(null);
    const failed: string[] = [];
    for (const f of files) {
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
        {/* The type is chosen first; uploads and pastes are filed under it. */}
        <div className="flex flex-wrap items-end gap-2">
          {/* The width is on the wrapper, so each Field's label sits above its select rather than beside it. */}
          <div className="w-48">
            <Field label="Type">
              <Select value={kind} onChange={(e) => setKind(e.target.value as MaterialKind)}>
                {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </Select>
            </Field>
          </div>
          {kind === "pyq" && (
            <div className="tab-in w-36">
              <Field label="Which exam">
                <ExamSelect value={exam} onChange={setExam} />
              </Field>
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <label
            className={cn(
              "group flex min-h-14 flex-1 cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-3 text-sm transition-colors duration-150 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent has-[:disabled]:cursor-default",
              // While files are read the box says what it's doing, in place, instead of fading out.
              busy ? "border-accent/40 bg-accent-soft" : "hover:border-accent/50 hover:bg-surface-2",
            )}
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted ring-1 ring-inset ring-border transition-colors duration-150 group-hover:text-accent" aria-hidden>
              {busy ? (
                <Loader2 size={16} className="animate-spin text-accent motion-reduce:animate-none" />
              ) : (
                <Upload size={16} className="transition-transform duration-200 ease-snappy group-hover:-translate-y-0.5" />
              )}
            </span>
            {busy ? (
              <span role="status" className="min-w-0 break-words font-medium text-accent">{busy}</span>
            ) : (
              <span><span className="font-medium text-text">Upload files</span> <span className="text-muted">PDF, text or photos</span></span>
            )}
            <input
              type="file"
              multiple
              accept="application/pdf,.txt,.md,image/*"
              className="sr-only"
              disabled={!!busy}
              onChange={(e) => { upload(Array.from(e.target.files ?? [])); e.target.value = ""; }}
            />
          </label>
          <Button
            variant="secondary"
            className="h-11 sm:h-auto sm:px-5"
            onClick={() => { setPaste((p) => p ?? { name: "", kind, exam, text: "" }); setPasteOpen(true); }}
          >
            <Plus size={16} /> Paste text
          </Button>
        </div>
        <p className="mt-3 max-w-prose text-[13px] leading-relaxed text-muted">
          PDFs are read in your browser and only the text is kept. Scanned PDFs and photos of notes are transcribed by AI. Upload past papers as
          &ldquo;Previous year paper&rdquo; to use them for predictions.
        </p>
        <div className="mt-2"><AiErrorBox error={error} /></div>
      </Card>

      {/* Nothing until loaded, so "No material yet" doesn't flash on a subject that has some. */}
      {!materials ? null : materials.length === 0 ? (
        <Section title="Files">
          {/* No icon chip: the upload box above is the next step, so this says what lands here and links the sync. */}
          <Empty title="No material yet">
            Notes, slides and past papers from your Google Drive folders appear here automatically after a sync (
            <Link href="/settings" className="font-medium text-accent underline decoration-accent/40 underline-offset-2 transition-colors duration-150 hover:decoration-accent">
              Settings → Google Drive
            </Link>
            ). You can also upload your own above. Every AI tool for this subject uses them.
          </Empty>
        </Section>
      ) : (
        <Section title={<span className="flex items-center gap-2">Files <Badge>{materials.length}</Badge></span>}>
          <Panel as="ul" className="divide-y divide-border">
            {materials.map((m) => (
              // Phones: icon, name and the actions share the first line; the selects drop under the name.
              // From sm up it's one line: icon, name, selects, actions.
              <li key={m.id} className="flex flex-wrap items-start gap-x-3.5 gap-y-2.5 px-4 py-3 transition-colors duration-150 hover:bg-surface-2/60 sm:flex-nowrap sm:items-center sm:px-5">
                {m.source ? (
                  <span className="order-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent/10 text-accent ring-1 ring-inset ring-accent/20" title="Synced from Google Drive"><Cloud size={15} /></span>
                ) : (
                  <span className="order-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted ring-1 ring-inset ring-border" aria-hidden><FileText size={15} /></span>
                )}
                {/* The name opens the preview too, so the row's largest target does something. A long name wraps to two lines
                    rather than being cut at a width that still has room. */}
                <button
                  type="button"
                  onClick={() => setPreview(m)}
                  title="Preview"
                  className="group/name order-2 min-w-0 flex-1 rounded-md text-left"
                >
                  <span className="line-clamp-2 break-words text-[15px] font-medium decoration-line-strong underline-offset-[3px] [overflow-wrap:anywhere] group-hover/name:underline">
                    {m.fileName}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] tabular-nums text-muted">
                    {m.source && <span className="min-w-0 truncate">Drive{m.source.path?.length ? ` / ${m.source.path.at(-1)}` : ""}</span>}
                    {m.source?.ocr && <Badge tone="accent">Read by AI</Badge>}
                    <span>{m.text.length.toLocaleString()} characters</span>
                    <span>{new Date(m.createdAt).toLocaleDateString()}</span>
                  </span>
                </button>
                {/* The actions stay at the row's end: on the name's line on phones, last on wider screens. */}
                <span className="order-3 -mr-1.5 flex shrink-0 items-center gap-0.5 sm:order-5 sm:mr-0">
                  {m.source && isDriveUrl(m.source.url) && (
                    <a
                      href={m.source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Open in Google Drive"
                      title="Open in Google Drive"
                      className="press relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-3 hover:text-text pointer-coarse:before:absolute pointer-coarse:before:-inset-1 pointer-coarse:before:content-['']"
                    >
                      <ExternalLink size={14} />
                    </a>
                  )}
                  <Button variant="ghost" size="icon" onClick={() => setPreview(m)} aria-label={`Preview ${m.fileName}`} title="Preview" className="hover:bg-surface-3"><Eye size={14} /></Button>
                  <Button
                    variant="danger"
                    size="icon"
                    title="Delete"
                    aria-label={`Delete ${m.fileName}`}
                    onClick={() => confirm(`Delete "${m.fileName}"?`) && deleteMaterial(m.id!)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </span>
                {/* Type (and, for past papers, which exam) can be fixed after upload instead of deleting and re-uploading.
                    On phones these sit under the name, lined up with it (the icon's 2rem plus the 0.875rem gap). */}
                <div className="order-4 flex basis-full flex-wrap items-center gap-1.5 pl-[2.875rem] sm:basis-auto sm:shrink-0 sm:flex-nowrap sm:pl-0">
                  <Select
                    value={m.kind}
                    aria-label={`Type of ${m.fileName}`}
                    className="h-8 w-auto py-0 text-xs pointer-coarse:h-10"
                    onChange={async (e) => {
                      const next = e.target.value as MaterialKind;
                      if (next === "pyq") {
                        await db.materials.update(m.id, m.pyqExam ? { kind: next } : { kind: next, pyqExam: mode });
                        analyseSubject(subjectId);
                        return;
                      }
                      // No longer a past paper: drop its questions so Important, Zero prep and the chat stop counting them,
                      // and clear analysedAt so it's split again if it's turned back into one.
                      await db.transaction("rw", db.materials, db.pyqQuestions, async () => {
                        await db.pyqQuestions.where({ materialId: m.id }).delete();
                        await db.materials.update(m.id, { kind: next, analysedAt: undefined });
                      });
                    }}
                  >
                    {KINDS.map((k) => <option key={k.value} value={k.value}>{k.value === "notes" && m.source?.format === "ppt" ? "Slides" : k.label}</option>)}
                  </Select>
                  {m.kind === "pyq" && (
                    <ExamSelect
                      value={pyqMode(m)}
                      label={`Which exam ${m.fileName} was for`}
                      className="h-8 w-auto py-0 text-xs pointer-coarse:h-10"
                      onChange={(e) => setPaperExam(m.id!, e)}
                    />
                  )}
                </div>
              </li>
            ))}
          </Panel>
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
  const [saveError, setSaveError] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (saving || !text.trim()) return;
        setSaving(true);
        setSaveError(false);
        try {
          await db.materials.add({
            subjectId, kind, fileName: name.trim() || "Pasted notes", text: text.trim(), createdAt: Date.now(),
            ...(kind === "pyq" ? { pyqExam: exam } : {}),
          });
          if (kind === "pyq") analyseSubject(subjectId);
          onDone();
        } catch {
          setSaving(false);
          setSaveError(true);
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
      {saveError && <p className="text-sm text-bad" role="alert">Couldn&apos;t save this material. Try again.</p>}
      <div className="flex justify-end"><Button type="submit" disabled={saving || !text.trim()}>{saving ? "Saving…" : "Save material"}</Button></div>
    </form>
  );
}
