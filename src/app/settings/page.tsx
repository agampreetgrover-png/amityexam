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
  const [msg, setMsg] = useState("");
  const file = useRef<HTMLInputElement>(null);
  if (!settings) return null;

  const set = (patch: Partial<Settings>) => db.settings.put({ ...DEFAULT_SETTINGS, ...settings, ...patch });
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
    if (typeof Notification === "undefined") return setMsg("This browser doesn't support notifications.");
    const p = await Notification.requestPermission();
    await set({ notifications: p === "granted" });
    if (p === "granted") await notify("Notifications on", "You'll get a daily study digest while the app is open.");
    else setMsg("Notification permission was denied. Enable it in your browser's site settings.");
  };

  const backup = async () => {
    try {
      downloadText(JSON.stringify(await exportAll()), `amityexams-backup-${today()}.json`, "application/json");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not export backup");
    }
  };

  const restore = async (f: File) => {
    try {
      if (!confirm("Replace ALL current data with this backup?")) return;
      let backup: unknown;
      try {
        backup = JSON.parse(await f.text());
      } catch {
        throw new Error("That file isn't a valid backup (not JSON).");
      }
      await importAll(backup);
      setMsg("Backup restored.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not read backup");
    }
  };

  return (
    <>
      <PageHeader title="Settings" />
      <div className="divide-y divide-border [&>section]:py-8 [&>section:first-child]:pt-0">
        <Section title="Exam mode">
          <p className="mb-4 max-w-prose text-sm text-muted">
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

        <Section title="Study plan">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Study time per day (minutes)" hint={`${(settings.dailyMinutes / 60).toFixed(1)} hours`}>
              <Input key={`dailyMinutes-${settings.dailyMinutes}`} {...num("dailyMinutes")} step={15} />
            </Field>
            <Field label="Longest single study block (minutes)"><Input key={`sessionMins-${settings.sessionMins}`} {...num("sessionMins")} step={15} /></Field>
            <Field label="Revision days before each exam"><Input key={`revisionDays-${settings.revisionDays}`} {...num("revisionDays")} /></Field>
          </div>
          <fieldset className="mt-4">
            <legend className="mb-1.5 text-[13px] font-medium text-muted">Days off</legend>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d, i) => {
                const on = settings.offDays.includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ offDays: on ? settings.offDays.filter((x) => x !== i) : [...settings.offDays, i] })}
                    className={cn(
                      "h-9 w-12 rounded-lg border text-sm transition-colors",
                      on ? "border-text bg-text font-semibold text-bg" : "border-border bg-surface text-muted hover:text-text",
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

        <Section title="Pomodoro">
          <div className="grid max-w-sm grid-cols-2 gap-4">
            <Field label="Focus (min)"><Input key={`pomodoroWork-${settings.pomodoroWork}`} {...num("pomodoroWork")} /></Field>
            <Field label="Break (min)"><Input key={`pomodoroBreak-${settings.pomodoroBreak}`} {...num("pomodoroBreak")} /></Field>
          </div>
        </Section>

        <Section title="Reminders">
          <p className="mb-4 max-w-prose text-sm text-muted">
            While the app is open you get a daily digest and an alert the day before each exam. For reminders when it&apos;s closed,
            export your plan to Google Calendar from the Planner.
          </p>
          {settings.notifications ? (
            <Button variant="secondary" onClick={() => set({ notifications: false })}><Bell size={16} /> Turn off notifications</Button>
          ) : (
            <Button onClick={enableNotifications}><Bell size={16} /> Turn on notifications</Button>
          )}
        </Section>

        <AiStatus />

        <DriveSettings />

        <Section title="Your data">
          <p className="mb-4 max-w-prose text-sm text-muted">
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
                if (confirm("Delete ALL data permanently? Export a backup first.")) {
                  await clearAll();
                  setMsg("All data deleted.");
                }
              }}
            >
              <Trash2 size={16} /> Delete everything
            </Button>
          </div>
          {msg && <p className="mt-3 text-sm" role="status">{msg}</p>}
        </Section>
      </div>
    </>
  );
}

/** Which AI keys the server has (booleans only) and which provider answered last. */
function AiStatus() {
  const [status, setStatus] = useState<{ gemini: boolean; groq: boolean } | "error" | null>(null);
  const [last, setLast] = useState<ReturnType<typeof getLastProvider>>(null);
  useEffect(() => {
    setLast(getLastProvider()); // read after mount: localStorage only exists in the browser
    fetch("/api/ai/status")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setStatus, () => setStatus("error"));
  }, []);
  const row = (name: string, on?: boolean) => (
    <li className="flex justify-between gap-3 py-1">
      <span>{name}</span>
      <span className={on ? "text-good" : "text-muted"}>{on ? "Configured" : "Not set"}</span>
    </li>
  );
  return (
    <Section title="AI">
      {status === "error" ? (
        <p className="text-sm text-muted">Couldn&apos;t check the AI setup. You may be offline.</p>
      ) : (
        <ul className="max-w-xs text-sm">
          {row("Gemini", status?.gemini)}
          {row("Groq", status?.groq)}
        </ul>
      )}
      {last && (
        <p className="mt-2 text-sm text-muted">
          Last answered by {last.provider === "groq" ? "Groq" : "Gemini"}, {new Date(last.at).toLocaleString()}
        </p>
      )}
      <p className="mt-3 max-w-prose text-xs text-muted">
        Gemini is used first. Groq takes over automatically when Gemini hits a limit. Keys live in .env.local on this computer.
      </p>
    </Section>
  );
}
