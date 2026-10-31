"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Bell, Download, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { clearAll, db, exportAll, getSettings, importAll, validateBackup } from "@/lib/db";
import { today } from "@/lib/dates";
import { downloadText } from "@/lib/download";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/types";
import { notify } from "@/components/notifier";
import { getLastProvider } from "@/lib/ai/client";
import { MODES, modeLabel } from "@/lib/mode";
import { THEMES, setTheme, useTheme } from "@/lib/theme";
import { DriveSettings } from "@/components/drive-settings";
import { Button, PageHeader, Section, Segmented, cn } from "@/components/ui";

// Settings groups sit on the page separated by rules, like sections of a printed form.
const group = "py-8 first:pt-0 last:pb-0";
const desc = "-mt-1 mb-5 max-w-prose text-sm text-muted";

export default function SettingsPage() {
  const settings = useLiveQuery(getSettings);
  const theme = useTheme();
  // Each section reports next to its own buttons, and the line clears on that section's next action.
  const [notifyMsg, setNotifyMsg] = useState("");
  const [dataMsg, setDataMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  // The browser's own permission, which the student can revoke in site settings behind the app's back.
  const [permission, setPermission] = useState<NotificationPermission | "unsupported" | null>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setPermission(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  }, []);
  if (!settings) return null;
  const notificationsOn = settings.notifications && permission === "granted";

  // Merge into the stored row, not this render's copy: quick successive changes (or a Drive sync
  // writing lastDriveSync meanwhile) would otherwise overwrite each other.
  const set = (patch: Partial<Settings>) =>
    db.transaction("rw", db.settings, async () => db.settings.put({ ...DEFAULT_SETTINGS, ...(await getSettings()), ...patch }));
  const enableNotifications = async () => {
    setNotifyMsg("");
    if (typeof Notification === "undefined") return setNotifyMsg("This browser doesn't support notifications.");
    const p = await Notification.requestPermission();
    setPermission(p);
    await set({ notifications: p === "granted" });
    if (p === "granted") await notify("Notifications on", "You'll get an alert the day before each exam while the app is open.");
    else setNotifyMsg("Notifications are blocked in your browser's site settings. Allow them there, then try again.");
  };

  const backup = async () => {
    setDataMsg(null);
    try {
      downloadText(JSON.stringify(await exportAll()), `amityexams-backup-${today()}.json`, "application/json");
      setDataMsg({ text: "Backup downloaded." });
    } catch (e) {
      setDataMsg({ text: e instanceof Error ? e.message : "Could not export backup", bad: true });
    }
  };

  // The file is read and checked before asking, so a wrong file never gets as far as "Replace ALL".
  const restore = async (f: File) => {
    setDataMsg(null);
    try {
      let backup: unknown;
      try {
        backup = JSON.parse(await f.text());
      } catch {
        throw new Error("That file isn't a valid backup (not JSON).");
      }
      validateBackup(backup);
      if (!confirm("Replace ALL current data with this backup?")) return;
      await importAll(backup);
      setDataMsg({ text: "Backup restored." });
    } catch (e) {
      setDataMsg({ text: e instanceof Error ? e.message : "Could not read backup", bad: true });
    }
  };

  return (
    <>
      <PageHeader title="Settings" />
      <div className="divide-y divide-border">
        <Section title="Exam mode" className={group}>
          <p className={desc}>
            The dashboard, exams list and AI tools follow this. Mid-sem and major each have their own syllabus: upload each one on a subject&apos;s Syllabus tab while in that mode.
          </p>
          <Segmented
            label="Exam mode"
            value={settings.examMode ?? "end-term"}
            onChange={(examMode) => set({ examMode })}
            options={MODES.map((m) => ({ value: m, label: modeLabel(m) }))}
          />
        </Section>

        <Section title="Appearance" className={group}>
          <p className={desc}>
            Dark is easier on the eyes for late revision. Match device follows your system setting. This is saved in this browser only.
          </p>
          <Segmented label="Theme" value={theme.choice} onChange={setTheme} options={THEMES} />
        </Section>

        <Section title="Reminders" className={group}>
          <p className={desc}>
            While the app is open you get an alert the day before each exam.
          </p>
          {notificationsOn ? (
            <Button variant="secondary" onClick={() => { setNotifyMsg(""); set({ notifications: false }); }}><Bell size={16} /> Turn off notifications</Button>
          ) : (
            <Button onClick={enableNotifications} disabled={permission === "unsupported"}><Bell size={16} /> Turn on notifications</Button>
          )}
          {notifyMsg ? (
            <p className="mt-3 text-sm text-warn" role="status">{notifyMsg}</p>
          ) : permission === "denied" ? (
            <p className="mt-3 text-sm text-muted">Notifications are blocked in your browser&apos;s site settings. Allow them there to turn reminders on.</p>
          ) : permission === "unsupported" ? (
            <p className="mt-3 text-sm text-muted">This browser doesn&apos;t support notifications.</p>
          ) : null}
        </Section>

        <AiStatus />

        <DriveSettings />

        <Section title="Your data" className={group}>
          <p className={desc}>
            Everything is stored only on this device. Export a backup regularly, and use export and import to move between phone and laptop.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={backup}><Download size={16} /> Export backup</Button>
            <Button variant="secondary" onClick={() => file.current?.click()}><Upload size={16} /> Import backup</Button>
            <input ref={file} type="file" accept="application/json" hidden onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = ""; // allow picking the same file again
                if (f) restore(f);
              }} />
            <Button
              variant="danger"
              className="text-bad"
              onClick={async () => {
                setDataMsg(null);
                // Settings go too, so the app returns to the "What are you preparing for?" screen; say so up front.
                if (
                  confirm(
                    "Delete ALL data permanently?\n\nThis removes every subject, exam, note and quiz, and also resets your settings, exam mode and Google Drive folders. The app will start over from the welcome screen.\n\nExport a backup first if you might need it.",
                  )
                ) {
                  await clearAll();
                }
              }}
            >
              <Trash2 size={16} /> Delete everything
            </Button>
          </div>
          {dataMsg && <p className={cn("mt-3 text-sm", dataMsg.bad && "text-bad")} role={dataMsg.bad ? "alert" : "status"}>{dataMsg.text}</p>}
        </Section>
      </div>
    </>
  );
}

const PROVIDER_LABELS: Record<string, string> = { gemini: "Gemini", openrouter: "OpenRouter" };

/** Which AI keys the server has (booleans only) and which provider answered last. */
function AiStatus() {
  const [status, setStatus] = useState<{ gemini: boolean; openrouter?: boolean } | "error" | null>(null);
  const [last, setLast] = useState<ReturnType<typeof getLastProvider>>(null);
  useEffect(() => {
    setLast(getLastProvider()); // read after mount: localStorage only exists in the browser
    fetch("/api/ai/status")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setStatus, () => setStatus("error"));
  }, []);
  const row = (name: string, on?: boolean) => (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <span className="font-medium">{name}</span>
      <span className={cn("inline-flex items-center gap-2", on ? "text-good" : "text-muted")}>
        <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", on ? "bg-good" : "bg-muted/50")} />
        {on ? "Configured" : "Not set"}
      </span>
    </li>
  );
  return (
    <Section title="AI" className={group}>
      <p className={desc}>
        OpenRouter is used first for everything, including reading scanned papers. Gemini takes over automatically when it hits a limit. Keys live in .env.local on this computer.
      </p>
      {status === "error" ? (
        <p className="text-sm text-muted">Couldn&apos;t check the AI setup. You may be offline.</p>
      ) : (
        <ul className="max-w-sm divide-y divide-border border-y border-border text-sm">
          {row("OpenRouter", status?.openrouter)}
          {row("Gemini", status?.gemini)}
        </ul>
      )}
      {last && (
        <p className="mt-3 text-sm text-muted">
          Last answered by {PROVIDER_LABELS[last.provider] ?? "Gemini"}, {new Date(last.at).toLocaleString()}
        </p>
      )}
    </Section>
  );
}
