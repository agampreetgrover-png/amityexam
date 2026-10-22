"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Bell, Download, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { clearAll, db, exportAll, getSettings, importAll } from "@/lib/db";
import { today } from "@/lib/dates";
import { downloadText } from "@/lib/download";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/types";
import { notify } from "@/components/notifier";
import { getLastProvider } from "@/lib/ai/client";
import { MODES, modeLabel } from "@/lib/mode";
import { DriveSettings } from "@/components/drive-settings";
import { Button, Field, Input, PageHeader, Section, Tabs, cn } from "@/components/ui";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Settings groups sit on the page separated by rules, like sections of a printed form.
const group = "py-8 first:pt-0 last:pb-0";
const desc = "-mt-1 mb-5 max-w-prose text-sm text-muted";

type NumKey = "dailyMinutes" | "sessionMins" | "revisionDays" | "pomodoroWork" | "pomodoroBreak";
const LIMITS: Record<NumKey, [number, number]> = {
  dailyMinutes: [30, 960],
  sessionMins: [15, 240],
  revisionDays: [0, 5],
  pomodoroWork: [5, 120],
  pomodoroBreak: [1, 60],
};

export default function SettingsPage() {
  const settings = useLiveQuery(getSettings);
  // Each section reports next to its own buttons, and the line clears on that section's next action.
  const [notifyMsg, setNotifyMsg] = useState("");
  const [dataMsg, setDataMsg] = useState("");
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
  // Saved on blur (not per keystroke) and clamped, so a half-typed or empty field can't store 0 or NaN.
  const num = (k: NumKey) => {
    const [min, max] = LIMITS[k];
    const value = settings[k];
    return {
      type: "number",
      defaultValue: value,
      min,
      max,
      onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
        const n = Math.round(Number(e.target.value));
        const next = e.target.value.trim() === "" || !Number.isFinite(n) ? value : Math.min(max, Math.max(min, n));
        e.target.value = String(next);
        if (next !== value) set({ [k]: next });
      },
      onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && e.currentTarget.blur(),
    };
  };

  const enableNotifications = async () => {
    setNotifyMsg("");
    if (typeof Notification === "undefined") return setNotifyMsg("This browser doesn't support notifications.");
    const p = await Notification.requestPermission();
    setPermission(p);
    await set({ notifications: p === "granted" });
    if (p === "granted") await notify("Notifications on", "You'll get a daily study digest while the app is open.");
    else setNotifyMsg("Notifications are blocked in your browser's site settings. Allow them there, then try again.");
  };

  const backup = async () => {
    setDataMsg("");
    try {
      downloadText(JSON.stringify(await exportAll()), `amityexams-backup-${today()}.json`, "application/json");
      setDataMsg("Backup downloaded.");
    } catch (e) {
      setDataMsg(e instanceof Error ? e.message : "Could not export backup");
    }
  };

  const restore = async (f: File) => {
    setDataMsg("");
    try {
      if (!confirm("Replace ALL current data with this backup?")) return;
      let backup: unknown;
      try {
        backup = JSON.parse(await f.text());
      } catch {
        throw new Error("That file isn't a valid backup (not JSON).");
      }
      await importAll(backup);
      setDataMsg("Backup restored.");
    } catch (e) {
      setDataMsg(e instanceof Error ? e.message : "Could not read backup");
    }
  };

  return (
    <>
      <PageHeader title="Settings" />
      <div className="divide-y divide-border">
        <Section title="Exam mode" className={group}>
          <p className={desc}>
            The dashboard, exams list, planner and AI tools follow this. Mid-sem and major each have their own syllabus: upload each one on a subject&apos;s Syllabus tab while in that mode.
          </p>
          <Tabs
            label="Exam mode"
            value={settings.examMode ?? "end-term"}
            onChange={(examMode) => set({ examMode })}
            options={MODES.map((m) => ({ value: m, label: modeLabel(m) }))}
          />
          <p className="mt-3 text-xs text-muted">After switching, open the Planner and press Rebalance.</p>
        </Section>

        <Section title="Study plan" className={group}>
          <p className={desc}>How much the planner schedules each day, and which days it leaves free.</p>
          <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <Field label="Study time per day (minutes)" hint={`${(settings.dailyMinutes / 60).toFixed(1)} hours`}>
              <Input key={`dailyMinutes-${settings.dailyMinutes}`} {...num("dailyMinutes")} step={15} />
            </Field>
            <Field label="Longest single study block (minutes)"><Input key={`sessionMins-${settings.sessionMins}`} {...num("sessionMins")} step={15} /></Field>
            <Field label="Revision days before each exam"><Input key={`revisionDays-${settings.revisionDays}`} {...num("revisionDays")} /></Field>
          </div>
          <fieldset className="mt-5">
            <legend className="mb-2 text-[13px] font-medium text-muted">Days off</legend>
            {/* One segmented row: each day is a cell, and a day off is filled navy. */}
            <div className="grid w-full max-w-sm grid-cols-7 divide-x divide-border overflow-hidden rounded-md border border-border">
              {DAYS.map((d, i) => {
                const on = settings.offDays.includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ offDays: on ? settings.offDays.filter((x) => x !== i) : [...settings.offDays, i] })}
                    className={cn(
                      // The ring is drawn inside the cell, since the row clips anything outside it.
                      "h-9 min-w-0 text-sm transition-colors duration-150 focus-visible:outline-offset-[-2px]",
                      on ? "bg-accent font-medium text-accent-ink" : "bg-surface text-muted hover:bg-surface-2 hover:text-text",
                    )}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <p className="mt-4 text-xs text-muted">After changing these, open the Planner and press Rebalance.</p>
        </Section>

        <Section title="Pomodoro" className={group}>
          <p className={desc}>Lengths of the focus timer and the break after it.</p>
          <div className="grid max-w-sm grid-cols-2 gap-4">
            <Field label="Focus (min)"><Input key={`pomodoroWork-${settings.pomodoroWork}`} {...num("pomodoroWork")} /></Field>
            <Field label="Break (min)"><Input key={`pomodoroBreak-${settings.pomodoroBreak}`} {...num("pomodoroBreak")} /></Field>
          </div>
        </Section>

        <Section title="Reminders" className={group}>
          <p className={desc}>
            While the app is open you get a daily digest and an alert the day before each exam. For reminders when it&apos;s closed,
            export your plan to Google Calendar from the Planner.
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
                setDataMsg("");
                // Settings go too, so the app returns to the "What are you preparing for?" screen; say so up front.
                if (
                  confirm(
                    "Delete ALL data permanently?\n\nThis removes every subject, exam, plan, note and quiz, and also resets your settings, exam mode and Google Drive folders. The app will start over from the welcome screen.\n\nExport a backup first if you might need it.",
                  )
                ) {
                  await clearAll();
                }
              }}
            >
              <Trash2 size={16} /> Delete everything
            </Button>
          </div>
          {dataMsg && <p className="mt-3 text-sm" role="status">{dataMsg}</p>}
        </Section>
      </div>
    </>
  );
}

const PROVIDER_LABELS: Record<string, string> = { gemini: "Gemini", groq: "Groq", openrouter: "OpenRouter" };

/** Which AI keys the server has (booleans only) and which provider answered last. */
function AiStatus() {
  const [status, setStatus] = useState<{ gemini: boolean; groq: boolean; openrouter?: boolean } | "error" | null>(null);
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
        Gemini is used first. Groq, then OpenRouter, take over automatically when it hits a limit. Keys live in .env.local on this computer.
      </p>
      {status === "error" ? (
        <p className="text-sm text-muted">Couldn&apos;t check the AI setup. You may be offline.</p>
      ) : (
        <ul className="max-w-sm divide-y divide-border border-y border-border text-sm">
          {row("Gemini", status?.gemini)}
          {row("Groq", status?.groq)}
          {row("OpenRouter", status?.openrouter)}
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
