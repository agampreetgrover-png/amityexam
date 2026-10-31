"use client";

import { format } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { Cloud, ExternalLink, Link2, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { db, getSettings } from "@/lib/db";
import { runDriveSync, useDriveSync } from "@/lib/drive/client";
import { DEFAULT_DRIVE_SOURCES, MAX_DRIVE_SOURCES, MAX_SOURCE_LABEL, folderIdFromLink } from "@/lib/drive/sources";
import type { Settings } from "@/lib/types";
import { toast } from "./toast";
import { Button, Card, Field, Input, Modal, Select, Switch, cn } from "./ui";

const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${id}`;

/** Settings card: which Drive folders are synced, sync status, and manual subject ↔ folder links. */
export function DriveSettings() {
  const settings = useLiveQuery(getSettings);
  const counts = useLiveQuery(async () => ({
    imported: await db.driveFiles.where({ status: "imported" }).count(),
    skipped: await db.driveFiles.where({ status: "skipped" }).count(),
  }));
  const sync = useDriveSync();
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState("");
  const [linking, setLinking] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [checking, setChecking] = useState(false);
  if (!settings) return null;

  // An empty list means the student removed every folder; only unset means the defaults.
  const sources = settings.driveSources ?? DEFAULT_DRIVE_SOURCES;
  // Read-modify-write in one transaction, from the stored list rather than the one drawn: adding a folder waits
  // on Drive for a second or two, and a folder removed meanwhile mustn't come back.
  const save = (change: Partial<Settings> | ((s: Settings) => Partial<Settings>)) =>
    db.transaction("rw", db.settings, async () => {
      const cur = await getSettings();
      await db.settings.put({ ...cur, ...(typeof change === "function" ? change(cur) : change) });
    });

  const addSource = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = folderIdFromLink(link.trim());
    if (!id) return setLinkError("Paste a Google Drive folder link (drive.google.com/drive/folders/…).");
    if (sources.some((s) => s.id === id)) return setLinkError("That folder is already in the list.");
    if (sources.length >= MAX_DRIVE_SOURCES) return setLinkError(`Up to ${MAX_DRIVE_SOURCES} folders can be synced. Remove one to add another.`);
    // Check it's public now (not at the next sync) and label it with its real name.
    setChecking(true);
    let name = "";
    try {
      const r = await fetch(`/api/drive/folders?info=${encodeURIComponent(id)}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setLinkError(j.error ?? "Couldn't open that folder.");
      name = String(j.name ?? "").slice(0, MAX_SOURCE_LABEL).trim(); // the sync turns away longer names
    } catch {
      return setLinkError("Couldn't reach Google Drive. Check your connection.");
    } finally {
      setChecking(false);
    }
    await save((cur) => {
      const list = cur.driveSources ?? DEFAULT_DRIVE_SOURCES;
      if (list.some((s) => s.id === id) || list.length >= MAX_DRIVE_SOURCES) return {};
      // Fallback name: smallest unused number, so removing a folder and adding another can't produce two "Folder 3"s.
      const used = new Set(list.map((s) => s.label));
      let n = 1;
      while (used.has(`Folder ${n}`)) n++;
      return { driveSources: [...list, { id, label: name && !used.has(name) ? name : `Folder ${n}` }] };
    });
    setLink("");
    setLinkError("");
  };

  return (
    <Card title="Google Drive">
      <p className="-mt-2 mb-5 max-w-prose text-sm text-muted">
        Notes, slides and past papers for your subjects are pulled from these shared folders. New files are fetched when you open the app.
        Past papers are tagged mid-sem or major from their names, and scanned ones are read by AI, up to 10 per open to save your AI quota.
      </p>

      {sources.length > 0 && (
        <ul className="mb-3 divide-y divide-border rounded-xl border border-border">
          {sources.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2 pl-3 pr-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted" aria-hidden><Cloud size={15} /></span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.label}</span>
              <a href={folderUrl(s.id)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${s.label} in Drive`} className="press relative inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-text pointer-coarse:before:absolute pointer-coarse:before:-inset-1 pointer-coarse:before:content-['']">
                <ExternalLink size={14} />
              </a>
              <Button
                type="button"
                variant="danger"
                size="icon"
                aria-label={`Remove ${s.label}`}
                onClick={() => confirm(`Stop syncing "${s.label}"? Files already imported stay.`) && save((cur) => ({ driveSources: (cur.driveSources ?? DEFAULT_DRIVE_SOURCES).filter((x) => x.id !== s.id) }))}
              >
                <X size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={addSource} className="mb-1 flex gap-2">
        <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a Drive folder link" aria-label="Drive folder link" />
        <Button type="submit" variant="secondary" disabled={!link.trim() || checking}>{checking ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Add</Button>
      </form>
      {linkError && <p className="mt-1 text-sm text-bad">{linkError}</p>}
      {settings.driveSources && (
        <button type="button" className="mt-1.5 text-xs text-muted underline-offset-2 transition-colors duration-150 hover:text-text hover:underline" onClick={() => save({ driveSources: undefined })}>
          Reset to the default folders
        </button>
      )}

      {/* Syncing and its status, ruled off from the folder list above. */}
      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-5">
        <Button onClick={() => runDriveSync()} disabled={sync.running}>
          {sync.running ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} {sync.running ? "Syncing…" : "Sync now"}
        </Button>
        <Button variant="secondary" onClick={() => setLinking(true)}><Link2 size={16} /> Link a folder to a subject</Button>
        <label className="ml-1 flex cursor-pointer items-center gap-2 text-sm text-muted transition-colors duration-150 hover:text-text">
          <Switch checked={settings.driveSync !== false} onChange={(on) => save({ driveSync: on })} labelledBy="drive-sync-label" />
          <span id="drive-sync-label">Sync when the app opens</span>
        </label>
      </div>

      <div className="mt-5 space-y-2 text-sm" role="status">
        {sync.message && (
          <p className={cn("flex items-center gap-2", sync.running && "font-medium")}>
            {sync.running && <Loader2 size={14} className="shrink-0 animate-spin text-muted" aria-hidden />}
            <span className={cn("min-w-0", sync.running && "truncate")}>{sync.message}</span>
          </p>
        )}
        {/* Sync status as a small definition list: what came in, what was passed over, and when. */}
        <dl className="divide-y divide-border rounded-xl border border-border">
          <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
            <dt className="text-muted">Files imported</dt>
            <dd className="font-medium tabular-nums">{counts?.imported ?? 0}</dd>
          </div>
          {!!counts?.skipped && (
            <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
              <dt className="min-w-0 text-muted">Skipped <span className="text-xs">(books, labs, unsupported or too large)</span></dt>
              <dd className="font-medium tabular-nums">{counts.skipped}</dd>
            </div>
          )}
          {settings.lastDriveSync && (
            <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
              <dt className="text-muted">Last synced</dt>
              <dd className="text-right tabular-nums">{format(new Date(settings.lastDriveSync), "d MMM, HH:mm")}</dd>
            </div>
          )}
        </dl>
        {sync.remaining > 0 && !sync.running && <p className="text-warn">{sync.remaining} more files found. They&apos;ll come in on the next sync.</p>}
        {sync.errors.length > 0 && (
          <div>
            <button type="button" className="text-warn underline-offset-2 hover:underline" onClick={() => setShowErrors((v) => !v)}>
              {sync.errors.length} file{sync.errors.length === 1 ? "" : "s"} couldn&apos;t be fetched (retried next time)
            </button>
            {showErrors && <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted">{sync.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
          </div>
        )}
        {sync.notices.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-warn">{sync.notices.map((n) => <li key={n}>{n}</li>)}</ul>
        )}
      </div>

      <Modal open={linking} onClose={() => setLinking(false)} title="Link a Drive folder to a subject">
        <LinkFolder onDone={() => setLinking(false)} />
      </Modal>
    </Card>
  );
}

/** For folders whose names don't match a subject on their own (e.g. "EN", "SKE"). */
function LinkFolder({ onDone }: { onDone: () => void }) {
  const subjects = useLiveQuery(() => db.subjects.orderBy("name").toArray());
  const [groups, setGroups] = useState<{ source: string; label: string; folders: { id: string; name: string }[] }[] | "error" | null>(null);
  const [subjectId, setSubjectId] = useState<number | "">("");
  const [folderId, setFolderId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const sources = (await getSettings()).driveSources;
      const qs = sources?.length ? "?" + sources.map((s) => `source=${encodeURIComponent(s.id)}`).join("&") : "";
      try {
        const r = await fetch(`/api/drive/folders${qs}`);
        if (!r.ok) throw new Error();
        const list: { source: string; label: string; folders: { id: string; name: string }[] }[] = await r.json();
        // The route only knows folder ids for custom sources; show the names given in Settings.
        setGroups(list.map((g) => ({ ...g, label: sources?.find((s) => s.id === g.source)?.label ?? g.label })));
      } catch {
        setGroups("error");
      }
    })();
  }, []);

  const sid = subjectId || subjects?.[0]?.id;
  const subject = subjects?.find((s) => s.id === sid);
  const linked = new Set(subject?.driveFolderIds ?? []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject || !folderId || saving) return;
    setSaving(true);
    await db.subjects.update(subject.id, { driveFolderIds: [...linked, folderId] });
    onDone();
    runDriveSync();
  };

  if (!subjects?.length) return <p className="text-sm text-muted">Add a subject first.</p>;
  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Subject">
        <Select value={sid ?? ""} onChange={(e) => { setSubjectId(Number(e.target.value)); setFolderId(""); }}>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </Field>
      <Field label="Drive folder">
        {groups === null ? (
          <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Loading folders…</p>
        ) : groups === "error" ? (
          <p className="text-sm text-bad">Couldn&apos;t load the Drive folders. Check your connection.</p>
        ) : (
          <Select value={folderId} onChange={(e) => setFolderId(e.target.value)} required>
            <option value="">Choose a folder…</option>
            {groups.map((g) => (
              <optgroup key={g.source} label={g.label}>
                {g.folders.map((f) => <option key={f.id} value={f.id} disabled={linked.has(f.id)}>{f.name}{linked.has(f.id) ? " (linked)" : ""}</option>)}
              </optgroup>
            ))}
          </Select>
        )}
      </Field>
      {linked.size > 0 && (
        <div className="text-sm">
          <p className="mb-2 text-[13px] font-medium text-muted">Already linked</p>
          <ul className="divide-y divide-border border-y border-border">
            {[...linked].map((id) => (
              <li key={id} className="flex items-center justify-between gap-2 py-2">
                <span className="truncate">{(groups !== "error" && groups?.flatMap((g) => g.folders).find((f) => f.id === id)?.name) || id}</span>
                <button type="button" className="-mr-2 shrink-0 rounded-md px-2 py-1 text-xs text-muted transition-colors duration-150 hover:bg-bad/10 hover:text-bad" onClick={() => db.subjects.update(subject!.id, { driveFolderIds: [...linked].filter((x) => x !== id) }).catch(() => toast("Couldn't save that. Try again."))}>
                  Unlink
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex justify-end"><Button type="submit" disabled={!folderId || saving}>Link and sync</Button></div>
    </form>
  );
}
