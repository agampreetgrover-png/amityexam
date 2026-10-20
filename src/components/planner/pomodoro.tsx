"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Pause, Play, RotateCcw, SkipForward, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { notify } from "@/components/notifier";
import { Button, Modal, cn } from "@/components/ui";
import { db } from "@/lib/db";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { addFocusMinutes } from "./actions";

type Phase = "work" | "break";

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
    osc.onended = () => ctx.close();
  } catch {
    // audio not available
  }
}

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/** Focus timer bound to one study session; focused minutes are logged to that session. */
export function Pomodoro({ sessionId, label, onClose }: { sessionId: number | null; label: string; onClose: () => void }) {
  const settings = useLiveQuery(() => db.settings.get("settings")) ?? DEFAULT_SETTINGS;
  const work = settings.pomodoroWork * 60;
  const brk = settings.pomodoroBreak * 60;

  const [phase, setPhase] = useState<Phase>("work");
  const [left, setLeft] = useState(work); // seconds, for display
  const [running, setRunning] = useState(false);
  const [logged, setLogged] = useState(0); // minutes logged this sitting
  const originalTitle = useRef<string>("");
  // Wall-clock timing: background tabs throttle intervals, so time is derived from timestamps.
  const endAt = useRef(0); // when the running phase ends
  const focusMs = useRef(0); // focused time not yet logged
  const focusFrom = useRef<number | null>(null); // start of the current running work stretch

  const pauseFocus = () => {
    if (focusFrom.current != null) focusMs.current += Date.now() - focusFrom.current;
    focusFrom.current = null;
  };

  // Reset when a new session opens.
  useEffect(() => {
    setPhase("work");
    setLeft(work);
    setRunning(false);
    setLogged(0);
    focusMs.current = 0;
    focusFrom.current = null;
  }, [sessionId, work]);

  const flush = useCallback(async () => {
    pauseFocus();
    const mins = Math.round(focusMs.current / 60_000);
    focusMs.current = 0; // cleared before awaiting so a second call can't log the same time
    if (sessionId != null && mins > 0) {
      await addFocusMinutes(sessionId, mins);
      setLogged((l) => l + mins);
    }
  }, [sessionId]);

  const switchPhase = useCallback(
    async (next: Phase, keepRunning: boolean) => {
      // Everything synchronous first, so a tick arriving mid-await can't switch twice.
      const logging = next === "break" ? flush() : undefined;
      const secs = next === "work" ? work : brk;
      if (keepRunning) {
        endAt.current = Date.now() + secs * 1000;
        if (next === "work") focusFrom.current = Date.now();
      }
      setPhase(next);
      setLeft(secs);
      beep();
      if (next === "break") notify("Focus block done", `Take a ${settings.pomodoroBreak}-minute break.`);
      else notify("Break over", `Back to: ${label}`);
      await logging;
    },
    [brk, flush, label, settings.pomodoroBreak, work],
  );

  const toggle = () => {
    if (running) {
      pauseFocus();
      setLeft(Math.max(0, Math.ceil((endAt.current - Date.now()) / 1000)));
      setRunning(false);
    } else {
      endAt.current = Date.now() + left * 1000;
      if (phase === "work") focusFrom.current = Date.now();
      setRunning(true);
    }
  };

  // Leaving the planner while the timer runs (e.g. tapping another page) unmounts this; log the focus time first.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => void flushRef.current(), []);

  // Reloading or closing the tab never unmounts: save whole minutes every minute while running (below)
  // and when the page is hidden. The timer keeps running; leftover seconds carry over so nothing is logged twice.
  const checkpoint = useCallback(() => {
    if (sessionId == null) return;
    const wasRunning = focusFrom.current != null;
    pauseFocus();
    const mins = Math.floor(focusMs.current / 60_000);
    focusMs.current -= mins * 60_000;
    if (wasRunning) focusFrom.current = Date.now();
    if (mins > 0) {
      void addFocusMinutes(sessionId, mins);
      setLogged((l) => l + mins);
    }
  }, [sessionId]);
  const checkpointRef = useRef(checkpoint);
  checkpointRef.current = checkpoint;
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") checkpointRef.current();
    };
    const onPageHide = () => checkpointRef.current();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  const switchRef = useRef(switchPhase);
  switchRef.current = switchPhase;
  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const secs = Math.ceil((endAt.current - Date.now()) / 1000);
      if (secs <= 0) switchRef.current(phase === "work" ? "break" : "work", true);
      else setLeft(secs);
    };
    const id = setInterval(tick, 500);
    // Browsers drop database writes started while a tab closes, so save focus time every minute instead.
    const save = setInterval(() => checkpointRef.current(), 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      clearInterval(save);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [running, phase]);

  // Show the countdown in the tab title while running.
  useEffect(() => {
    if (!originalTitle.current) originalTitle.current = document.title;
    document.title = running ? `${mmss(Math.max(0, left))} · ${phase === "work" ? "Focus" : "Break"}` : originalTitle.current;
  }, [left, running, phase]);
  useEffect(() => () => {
    if (originalTitle.current) document.title = originalTitle.current;
  }, []);

  const stop = async () => {
    setRunning(false);
    await flush();
    onClose();
  };

  const total = phase === "work" ? work : brk;
  const pct = total ? ((total - left) / total) * 100 : 0;

  return (
    <Modal open={sessionId != null} onClose={stop} title="Focus timer">
      <div className="flex flex-col items-center gap-5 py-2 text-center">
        <div>
          <p className={cn("text-sm font-semibold", phase === "work" ? "text-accent" : "text-good")}>
            {phase === "work" ? "Focus" : "Break"}
          </p>
          <p className="mt-0.5 max-w-xs text-sm text-muted">{label}</p>
        </div>
        <div className="relative grid h-52 w-52 place-items-center">
          <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
            <circle cx="50" cy="50" r="46" fill="none" stroke="var(--surface-2)" strokeWidth="4" />
            <circle
              cx="50" cy="50" r="46" fill="none"
              stroke={phase === "work" ? "var(--accent)" : "var(--good)"}
              strokeWidth="4" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 46}
              strokeDashoffset={2 * Math.PI * 46 * (1 - pct / 100)}
              className="transition-[stroke-dashoffset] duration-1000 ease-linear"
            />
          </svg>
          <span className="numeral text-[64px]" role="timer">{mmss(Math.max(0, left))}</span>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={toggle} className="min-w-28">
            {running ? <><Pause size={16} /> Pause</> : <><Play size={16} /> Start</>}
          </Button>
          {/* Reset restarts the countdown, but focus time already spent is logged first, never thrown away. */}
          <Button variant="secondary" onClick={() => { setRunning(false); void flush(); setLeft(total); }} aria-label="Reset timer">
            <RotateCcw size={16} />
          </Button>
          <Button variant="secondary" onClick={() => switchPhase(phase === "work" ? "break" : "work", running)} aria-label="Skip phase">
            <SkipForward size={16} />
          </Button>
          <Button variant="secondary" onClick={stop}>
            <Square size={14} /> Stop and log
          </Button>
        </div>
        <p className="text-xs text-muted">
          {logged} min logged this sitting, {settings.pomodoroWork} min focus and {settings.pomodoroBreak} min break
        </p>
      </div>
    </Modal>
  );
}
