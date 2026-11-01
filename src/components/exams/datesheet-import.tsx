"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, CalendarCheck, ChevronRight, Cloud, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { aiJson } from "@/lib/ai/client";
import { db, getSettings } from "@/lib/db";
import { clashFor, planImport, relevantRows, subjectLabels, type ImportRow } from "@/lib/datesheet/plan";
import { DATESHEET_ACCEPT, fetchDriveDatesheet, readDatesheet } from "@/lib/datesheet/read";
import { prettyDay } from "@/lib/dates";
import { DEFAULT_CHECKLIST, EXAM_TYPES } from "@/lib/exams";
import type { ExamType } from "@/lib/types";
import { AiErrorBox } from "../ai-error";
import { OfflineHint, useOnline } from "../subject/shared";
import { Badge, Button, Empty, Input, Segmented, Select, cn } from "../ui";

type Source = "upload" | "drive";

/**
 * The review's action row, pinned to the foot of the Modal's scroll area with the body's padding pulled back so it
 * sits flush (and covers the home-indicator strip on a phone's bottom sheet). Same row as the exam form's.
 */
const dialogFoot =
  "sticky z-10 -mx-5 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface px-5 pt-3 bottom-[calc(-1.5rem_-_env(safe-area-inset-bottom))] mb-[calc(-1.5rem_-_env(safe-area-inset-bottom))] pb-[calc(0.75rem_+_env(safe-area-inset-bottom))] sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:rounded-b-[15px] sm:px-6 sm:pb-3";

/** What the file picker's accept list lets through, checked again for a dropped file (a drop skips that filter). */
const looksLikeDatesheet = (f: File) => /\.(xlsx|xls|ods|csv|pdf)$/i.test(f.name) || f.type === "application/pdf" || f.type.startsWith("image/");

type DriveSheet = { id: string; name: string; path: string[] };

/** The exams found in a date sheet, waiting for the student's review. */
export interface ImportDraft { rows: ImportRow[]; fileName: string }

/**
 * Upload or pick a university date sheet; AI finds the student's exams; they review and save.
 * The review is held by the caller (the dialog's content unmounts on close), so an accidental Esc doesn't lose it.
 */
export function DatesheetImport({ draft, onDraft, onDone }: { draft: ImportDraft | null; onDraft: (d: ImportDraft | null) => void; onDone: () => void }) {
  const subjects = useLiveQuery(() => db.subjects.orderBy("name").toArray());
  const [source, setSource] = useState<Source>("upload");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const [saved, setSaved] = useState<{ added: number; updated: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const online = useOnline();
  const canTake = !busy && online;

  if (!subjects) return null;
  if (!subjects.length) {
    return (
      <Empty icon={<FileSpreadsheet size={20} />} title="Add your subjects first">
        The date sheet lists every programme, so the app needs your subjects (ideally with course codes) to pick out your exams.{" "}
        <Link href="/subjects" className="font-medium text-accent hover:underline">Go to Subjects</Link>
      </Empty>
    );
  }

  const analyse = async (file: File) => {
    setError(null);
    try {
      setBusy(`Reading ${file.name}…`);
      const text = await readDatesheet(file, (s) => setBusy(s));
      setBusy("Finding your exams…");
      // The file name often carries the exam season ("MID-SEM Schedule…", "Odd Semester Examination…") when the sheet doesn't.
      const found = await aiJson("datesheet", { text: `File: ${file.name}\n${relevantRows(text, subjects)}`, topics: subjectLabels(subjects) });
      onDraft({ rows: planImport(found.exams, subjects, await db.exams.toArray()), fileName: file.name });
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  };

  if (saved) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <CalendarCheck size={18} className="mt-0.5 shrink-0 text-good" aria-hidden />
          <p className="font-semibold">{savedSummary(saved)}</p>
        </div>
        <div className="flex justify-end">
          <Button onClick={onDone}>Close</Button>
        </div>
      </div>
    );
  }

  if (draft) {
    return (
      <Review
        rows={draft.rows}
        setRows={(rows) => onDraft({ ...draft, rows })}
        subjects={subjects}
        fileName={draft.fileName}
        showSkipped={showSkipped}
        setShowSkipped={setShowSkipped}
        onBack={() => onDraft(null)}
        onSaved={(s) => {
          setSaved(s);
          onDraft(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Upload the university date sheet (Excel, PDF or a photo) or pick one from your Drive folders. AI finds the exams for your{" "}
        {subjects.length} subject{subjects.length === 1 ? "" : "s"}, matching by course code, and you check them before anything is saved.
      </p>
      <Segmented label="Date sheet source" value={source} onChange={setSource} options={[{ value: "upload", label: "Upload a file" }, { value: "drive", label: "From Drive" }]} />
      <OfflineHint online={online}>You&apos;re offline. Reading a date sheet needs AI, so connect to the internet first.</OfflineHint>
      {source === "upload" ? (
        <label
          // A file dropped anywhere on the zone is read like a chosen one. Every drag is caught, even while it can't
          // take a file, or the browser would open the dropped file in place of the app.
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = canTake ? "copy" : "none";
            if (canTake && !dragging) setDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (!f || !canTake) return;
            if (!looksLikeDatesheet(f)) {
              setError("Can't read a date sheet from that file. Drop an Excel or CSV file, a PDF or a photo.");
              return;
            }
            void analyse(f);
          }}
          // The file input is visually hidden, so the zone itself draws the keyboard focus outline.
          className={cn(
            "flex min-h-40 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-6 py-8 text-center text-sm text-muted transition-[border-color,background-color] duration-150 ease-snappy has-[input:focus-visible]:border-accent has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-accent",
            dragging
              ? "border-accent bg-accent-soft"
              : busy
                ? "cursor-progress border-line-strong bg-surface-2/60"
                : !online
                  ? "cursor-not-allowed border-line-strong opacity-60"
                  : "group cursor-pointer border-line-strong hover:border-accent/60 hover:bg-surface-2",
          )}
        >
          {busy ? (
            // The reading shows here, where the file went, rather than in a line under the zone.
            <>
              <Loader2 size={18} className="animate-spin text-accent motion-reduce:animate-none" aria-hidden />
              <span role="status" className="font-medium text-text">{busy}</span>
            </>
          ) : (
            <>
              <Upload
                size={18}
                aria-hidden
                className={cn(
                  "transition-[transform,color] duration-200 ease-snappy group-hover:-translate-y-0.5 group-hover:text-accent",
                  dragging ? "-translate-y-0.5 text-accent" : "text-muted",
                )}
              />
              {dragging ? (
                <span className="font-medium text-accent">Drop to read it</span>
              ) : (
                <span>
                  <span className="font-medium text-text">Choose a date sheet</span>
                  <span className="hidden pointer-fine:inline"> or drop it here</span> (.xlsx, .xls, .csv, PDF or photo)
                </span>
              )}
            </>
          )}
          <input
            type="file"
            accept={DATESHEET_ACCEPT}
            className="sr-only"
            disabled={!!busy || !online}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) analyse(f);
            }}
          />
        </label>
      ) : (
        <DrivePicker disabled={!!busy || !online} onPick={async (sheet, sources) => {
          setError(null);
          setBusy(`Downloading ${sheet.name}…`);
          try {
            await analyse(await fetchDriveDatesheet(sheet.id, sheet.name, sources));
          } catch (e) {
            setError(e);
            setBusy("");
          }
        }} />
      )}
      {busy && source === "drive" && (
        <p role="status" className="flex items-center gap-2 text-sm font-medium"><Loader2 size={15} className="animate-spin text-accent motion-reduce:animate-none" aria-hidden /> {busy}</p>
      )}
      <AiErrorBox error={error} />
    </div>
  );
}

function DrivePicker({ disabled, onPick }: { disabled: boolean; onPick: (s: DriveSheet, sources?: string[]) => void }) {
  const [sheets, setSheets] = useState<DriveSheet[] | "error" | null>(null);
  const [sources, setSources] = useState<string[] | undefined>();
  useEffect(() => {
    let alive = true;
    (async () => {
      const ids = (await getSettings()).driveSources?.map((s) => s.id);
      const qs = ids?.length ? "?" + ids.map((id) => `source=${encodeURIComponent(id)}`).join("&") : "";
      try {
        const r = await fetch(`/api/drive/datesheets${qs}`);
        if (!r.ok) throw new Error();
        const list: DriveSheet[] = await r.json();
        if (alive) {
          setSources(ids);
          setSheets(list);
        }
      } catch {
        if (alive) setSheets("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (sheets === null) return <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> Looking in your Drive folders…</p>;
  if (sheets === "error") return <AiErrorBox error="Couldn't reach your Drive folders. Check your connection, or upload the file instead." />;
  if (!sheets.length) return <p className="rounded-lg border border-dashed border-line-strong px-4 py-5 text-sm text-muted">No date sheets found in your Drive folders (files named like &ldquo;datesheet&rdquo; or &ldquo;examination schedule&rdquo;). Upload the file instead.</p>;
  return (
    // No overflow clipping here: it would cut off the focus ring around each row's button.
    <ul className="divide-y divide-border rounded-xl border border-border">
      {sheets.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPick(s, sources)}
            className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 [li:first-child>&]:rounded-t-[11px] [li:last-child>&]:rounded-b-[11px] enabled:hover:bg-surface-2 enabled:active:bg-surface-3/60 disabled:cursor-progress disabled:opacity-60"
          >
            <Cloud size={16} className="shrink-0 text-muted" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{s.name}</span>
              {s.path.length > 0 && <span className="block truncate text-xs text-muted">{s.path.join(" / ")}</span>}
            </span>
            <ChevronRight size={16} aria-hidden className="shrink-0 text-faint transition-transform duration-200 ease-snappy group-enabled:group-hover:translate-x-0.5" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** "Added 2 exams and updated 1." with the first part capitalised, whichever it is. */
function savedSummary({ added, updated }: { added: number; updated: number }) {
  const parts = [
    added ? `added ${added} exam${added === 1 ? "" : "s"}` : "",
    updated ? `updated ${updated}${added ? "" : ` exam${updated === 1 ? "" : "s"}`}` : "",
  ].filter(Boolean);
  const text = parts.length ? parts.join(" and ") : "nothing to save";
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

/** Same check planImport runs, for a row whose subject, type or date the student changed. */
function Review({ rows, setRows, subjects, fileName, showSkipped, setShowSkipped, onBack, onSaved }: {
  rows: ImportRow[];
  setRows: (r: ImportRow[]) => void;
  subjects: { id?: number; name: string }[];
  fileName: string;
  showSkipped: boolean;
  setShowSkipped: (v: boolean) => void;
  onBack: () => void;
  onSaved: (s: { added: number; updated: number }) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const existing = useLiveQuery(() => db.exams.toArray()) ?? [];
  const patch = (key: string, p: Partial<ImportRow>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));
  // Changing what the row is re-runs the existing-exam check, so a duplicate can't sneak in as "add".
  const repatch = (r: ImportRow, p: Partial<ImportRow>) => {
    const next = { ...r, ...p };
    const match = clashFor(existing, next.subjectId, next.type, next.date);
    // An exam that's already saved is unticked, or saving would add it a second time.
    patch(r.key, { ...p, ...match, include: next.include && !match.duplicate });
  };
  const mine = rows.filter((r) => r.subjectId != null);
  const skipped = rows.length - mine.length;
  const visible = showSkipped ? rows : mine;
  const chosen = rows.filter((r) => r.include && r.subjectId != null && r.date);
  const missingDate = rows.filter((r) => r.include && r.subjectId != null && !r.date).length;

  const save = async () => {
    if (saving || !chosen.length) return;
    setSaving(true);
    setError(null);
    try {
      let added = 0, updated = 0;
      // Two rows can clash with the same saved exam (same subject and type, different dates). Only the first
      // updates it; the rest are added, or the second update would silently overwrite the first.
      const updatedIds = new Set<number>();
      await db.transaction("rw", db.exams, async () => {
        for (const r of chosen) {
          const data = { subjectId: r.subjectId!, type: r.type, date: r.date, time: r.time || undefined, durationMins: r.durationMins };
          if (r.clash?.id && r.action === "update" && !updatedIds.has(r.clash.id)) {
            updatedIds.add(r.clash.id);
            await db.exams.update(r.clash.id, data);
            updated++;
          } else {
            await db.exams.add({ ...data, topicIds: [], checklist: DEFAULT_CHECKLIST });
            added++;
          }
        }
      });
      onSaved({ added, updated });
    } catch (e) {
      setError(e);
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Found {mine.length} exam{mine.length === 1 ? "" : "s"} for your subjects in <span className="font-medium text-text">{fileName}</span>. Check the dates, then save.
      </p>
      {!mine.length && (
        <p className="rounded-xl border border-mark/25 bg-mark-soft px-4 py-3 text-sm text-text">
          None of your subjects were found. Make sure each subject has its course code (e.g. CSE201), or check this is your programme&apos;s date sheet.
        </p>
      )}
      {/* A hairline table. Rows left out sit on a grey wash, so the ticked ones read as the list being saved.
          The padding keeps focus rings clear of the clipped corners. On phones subject and type take a line each,
          with date and time side by side under them; from sm up it's two columns. */}
      {visible.length > 0 && <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
        {visible.map((r) => {
          const name = subjects.find((s) => s.id === r.subjectId)?.name ?? "unmatched exam";
          return (
          <li key={r.key} className={cn("p-3 transition-colors duration-150 ease-snappy", !r.include && "bg-surface-2/60")}>
            <div className="flex items-start gap-2.5">
              {/* The tick's whole cell is the target, as tall as the fields beside it. */}
              <label
                className={cn(
                  "-ml-1.5 grid size-9 shrink-0 place-items-center rounded-md transition-colors duration-150",
                  r.subjectId == null ? "cursor-not-allowed" : "cursor-pointer hover:bg-surface-3/60",
                )}
              >
                <input
                  type="checkbox"
                  className="size-4"
                  aria-label={`Include ${name}`}
                  checked={r.include}
                  disabled={r.subjectId == null}
                  onChange={(e) => patch(r.key, { include: e.target.checked })}
                />
              </label>
              <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_9.5rem]">
                <Select
                  className="col-span-2 sm:col-span-1"
                  aria-label="Subject"
                  value={r.subjectId ?? ""}
                  onChange={(e) => {
                    const subjectId = e.target.value ? Number(e.target.value) : null;
                    repatch(r, { subjectId, include: subjectId != null });
                  }}
                >
                  <option value="">Not my subject</option>
                  {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
                <Select className="col-span-2 sm:col-span-1" aria-label={`Exam type for ${name}`} value={r.type} onChange={(e) => repatch(r, { type: e.target.value as ExamType })}>
                  {EXAM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
                <div>
                  <Input
                    type="date"
                    aria-label={`Date for ${name}`}
                    aria-invalid={r.include && !r.date}
                    aria-describedby={r.include && !r.date ? `${r.key}-date-error` : undefined}
                    value={r.date}
                    onChange={(e) => repatch(r, { date: e.target.value })}
                  />
                  {r.include && !r.date && <p id={`${r.key}-date-error`} className="mt-1 text-xs text-bad">Add a date to save this exam</p>}
                </div>
                <Input type="time" aria-label={`Start time for ${name}`} value={r.time} onChange={(e) => patch(r.key, { time: e.target.value })} />
              </div>
            </div>
            {r.duplicate && (
              <p className="mt-2 flex flex-wrap items-center gap-2 pl-10 text-xs text-muted">
                <Badge>Already saved</Badge> In your exams on {prettyDay(r.date)}.
              </p>
            )}
            {r.clash && (
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-10 text-xs">
                <Badge tone="warn"><AlertTriangle aria-hidden /> Clash</Badge>
                <span className="text-muted">You already have this exam on {prettyDay(r.clash.date)}.</span>
                <Select aria-label="What to do" className="h-8 w-auto py-0 text-xs" value={r.action} onChange={(e) => patch(r.key, { action: e.target.value as ImportRow["action"] })}>
                  <option value="update">Update it to this date</option>
                  <option value="add">Add as a new exam</option>
                </Select>
              </div>
            )}
          </li>
          );
        })}
      </ul>}
      {skipped > 0 && (
        <button
          type="button"
          aria-expanded={showSkipped}
          className="press -mx-1.5 rounded-md px-1.5 py-1 text-sm text-muted underline-offset-2 hover:text-text hover:underline"
          onClick={() => setShowSkipped(!showSkipped)}
        >
          {showSkipped ? "Hide" : "Show"} {skipped} exam{skipped === 1 ? "" : "s"} that didn&apos;t match your subjects
        </button>
      )}
      {missingDate > 0 && (
        <p className="text-sm text-warn">
          {missingDate} ticked exam{missingDate === 1 ? " has" : "s have"} no date and won&apos;t be saved until you add one.
        </p>
      )}
      <AiErrorBox error={error} />
      {/* Pinned to the foot of the dialog's scroll area (as in the exam form), so Save stays in reach under a long sheet. */}
      <div className={cn(dialogFoot, "justify-between")}>
        <Button variant="secondary" onClick={onBack} disabled={saving}>Use another file</Button>
        <Button onClick={save} disabled={saving || !chosen.length}>
          {saving ? "Saving…" : `Save ${chosen.length} exam${chosen.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}
