"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { format } from "date-fns";
import { Check, Download, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { clearAll, db, exportAll, getSettings, importAll, validateBackup } from "@/lib/db";
import { today } from "@/lib/dates";
import { downloadText } from "@/lib/download";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/types";
import { notify } from "@/components/notifier";
import { getLastProvider } from "@/lib/ai/client";
import { MODES, modeLabel } from "@/lib/mode";
import { setTheme, useTheme, type ThemeChoice } from "@/lib/theme";
import { DriveSettings } from "@/components/drive-settings";
import { Badge, Button, Card, PageHeader, Segmented, cn, Switch } from "@/components/ui";

// Each group is its own card, one column of them, with the explanation tucked under the card's title.
const desc = "-mt-2 mb-5 max-w-prose text-sm text-muted";

export default function SettingsPage() {
  const settings = useLiveQuery(getSettings);
  const theme = useTheme();
  // Each section reports next to its own buttons, and the line clears on that section's next action.
  const [notifyMsg, setNotifyMsg] = useState("");
  const [dataMsg, setDataMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  // The browser's own permission, which the student can revoke in site settings behind the app's back.
  const [permission, setPermission] = useState<NotificationPermission | "unsupported" | null>(null);
  // Where the switch was just flipped to, shown while the permission prompt or the save is still out.
  const [flipping, setFlipping] = useState<boolean | null>(null);
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
  const toggleNotifications = async (on: boolean) => {
    if (flipping !== null) return;
    setFlipping(on);
    try {
      if (on) await enableNotifications();
      else {
        setNotifyMsg("");
        await set({ notifications: false });
      }
    } finally {
      setFlipping(null);
    }
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
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" />
      <div className="space-y-6">
        <Card title="Exam mode">
          <p className={desc}>
            The dashboard, exams list and AI tools follow this. Mid-sem and major each have their own syllabus: upload each one on a subject&apos;s Syllabus tab while in that mode.
          </p>
          <Segmented
            label="Exam mode"
            value={settings.examMode ?? "end-term"}
            onChange={(examMode) => set({ examMode })}
            options={MODES.map((m) => ({ value: m, label: modeLabel(m) }))}
          />
        </Card>

        <Card title="Appearance">
          <p className={desc}>
            Dark is easier on the eyes for late revision. System follows your device setting. This is saved in this browser only.
          </p>
          <ThemePicker value={theme.choice} />
        </Card>

        <Card title="Reminders">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p id="notify-label" className="text-sm font-medium">Exam reminders</p>
              <p id="notify-desc" className="mt-0.5 text-sm text-muted">While the app is open you get an alert the day before each exam.</p>
            </div>
            <Switch
              checked={flipping ?? notificationsOn}
              onChange={toggleNotifications}
              disabled={permission === "unsupported"}
              labelledBy="notify-label"
              describedBy="notify-desc"
            />
          </div>
          {notifyMsg ? (
            <p className="mt-4 text-sm text-warn" role="status">{notifyMsg}</p>
          ) : permission === "denied" ? (
            <p className="mt-4 text-sm text-muted">Notifications are blocked in your browser&apos;s site settings. Allow them there to turn reminders on.</p>
          ) : permission === "unsupported" ? (
            <p className="mt-4 text-sm text-muted">This browser doesn&apos;t support notifications.</p>
          ) : null}
        </Card>

        <AiStatus />

        <DriveSettings />

        <Card title="Your data">
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
          </div>
          {dataMsg && <p className={cn("mt-3 text-sm", dataMsg.bad && "text-bad")} role={dataMsg.bad ? "alert" : "status"}>{dataMsg.text}</p>}

          {/* The one action that can't be undone, ruled off below the everyday ones. */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-border pt-5">
            <div className="min-w-0">
              <p className="text-sm font-medium">Delete everything</p>
              <p className="mt-0.5 text-sm text-muted">Removes all subjects, exams, notes and quizzes and resets your settings.</p>
            </div>
            <Button
              variant="secondary"
              className="text-bad hover:border-bad/40 hover:bg-bad/10"
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
        </Card>
      </div>
    </div>
  );
}

const THEME_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/** Light, dark or system as three cards, each with a small drawing of a page in that theme. Native radios underneath. */
function ThemePicker({ value }: { value: ThemeChoice }) {
  return (
    <fieldset className="grid min-w-0 grid-cols-3 gap-2 sm:gap-3">
      <legend className="sr-only">Theme</legend>
      {THEME_OPTIONS.map((o) => (
        <label
          key={o.value}
          className={cn(
            "cursor-pointer rounded-xl border p-1.5 transition-colors duration-150 sm:p-2",
            "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
            value === o.value ? "border-accent bg-accent-soft ring-1 ring-accent" : "border-border hover:border-line-strong hover:bg-surface-2",
          )}
        >
          <input type="radio" name="theme" value={o.value} checked={value === o.value} onChange={() => setTheme(o.value)} className="sr-only" />
          {o.value === "system" ? (
            // Light on the left, dark on the right: the device decides which one shows.
            <div className="relative" aria-hidden>
              <ThemePreview scheme="light" />
              <ThemePreview scheme="dark" className="absolute inset-0 [clip-path:inset(0_0_0_50%)]" />
            </div>
          ) : (
            <ThemePreview scheme={o.value} />
          )}
          <span className={cn("mt-2 flex items-center justify-between gap-1 px-1 pb-0.5 text-[13px] font-medium", value === o.value ? "text-accent" : "text-text")}>
            {o.label}
            {value === o.value && (
              <span aria-hidden className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-accent-solid text-accent-ink">
                <Check size={11} strokeWidth={3} />
              </span>
            )}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * A sidebar, a card and a button in miniature. The colour tokens use light-dark(), so pinning color-scheme
 * on the box draws it in that theme whatever the page is showing.
 */
function ThemePreview({ scheme, className }: { scheme: "light" | "dark"; className?: string }) {
  return (
    <div aria-hidden style={{ colorScheme: scheme }} className={cn("flex aspect-[4/3] overflow-hidden rounded-lg border border-border bg-bg", className)}>
      <div className="w-1/4 space-y-1 border-r border-border bg-side p-1.5">
        <div className="h-1 rounded-full bg-accent" />
        <div className="h-1 rounded-full bg-track" />
        <div className="h-1 rounded-full bg-track" />
      </div>
      <div className="flex-1 space-y-1.5 p-1.5 sm:p-2">
        <div className="h-1.5 w-1/2 rounded-full bg-text/70" />
        <div className="space-y-1 rounded-md border border-border bg-surface p-1.5">
          <div className="h-1 rounded-full bg-track" />
          <div className="h-1 w-2/3 rounded-full bg-track" />
        </div>
        <div className="h-2 w-1/3 rounded-sm bg-accent-solid" />
      </div>
    </div>
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
  const row = (name: string, role: string, on?: boolean) => (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{name}</p>
        <p className="text-xs text-muted">{role}</p>
      </div>
      {status === null ? (
        <Badge>Checking…</Badge>
      ) : (
        <Badge tone={on ? "good" : "neutral"}>
          <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", on ? "bg-good" : "bg-faint")} />
          {on ? "Configured" : "Not configured"}
        </Badge>
      )}
    </li>
  );
  return (
    <Card title="AI provider">
      <p className={desc}>
        OpenRouter is used first for everything, including reading scanned papers. Gemini takes over automatically when it hits a limit. Keys live in .env.local on this computer.
      </p>
      {status === "error" ? (
        <p className="text-sm text-muted">Couldn&apos;t check the AI setup. You may be offline.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {row("OpenRouter", "Used first", status?.openrouter)}
          {row("Gemini", "Fallback", status?.gemini)}
        </ul>
      )}
      {last && (
        <p className="mt-3 text-sm text-muted">
          Last answered by {PROVIDER_LABELS[last.provider] ?? "Gemini"}, {format(new Date(last.at), "d MMM, HH:mm")}
        </p>
      )}
    </Card>
  );
}
