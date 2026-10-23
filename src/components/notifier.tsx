"use client";

import { useEffect } from "react";
import { db, getSettings } from "@/lib/db";
import { addDay, today } from "@/lib/dates";

const KEY = "amityexams:lastNotified";

/** `tag` makes a repeat (e.g. from a second open tab) replace the earlier notification instead of stacking. */
export async function notify(title: string, body: string, tag?: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const options = { body, icon: "/icon-192.png", badge: "/icon-192.png", tag };
  try {
    // Mobile browsers only allow notifications through an active service worker.
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.active) await reg.showNotification(title, options);
    else new Notification(title, options);
  } catch {
    // e.g. Android Chrome without a service worker rejects `new Notification`
  }
}

/** Alerts the day before each exam while the app is open. */
export function Notifier() {
  useEffect(() => {
    let running = false;
    const check = async () => {
      if (running) return;
      running = true;
      try {
        const settings = await getSettings();
        const d = today();
        if (!settings.notifications || Notification.permission !== "granted" || localStorage.getItem(KEY) === d) return;
        // Claim the day first so overlapping checks or a failing notification can't repeat it.
        localStorage.setItem(KEY, d);
        const examsTomorrow = await db.exams.where("date").equals(addDay(d, 1)).toArray();
        for (const e of examsTomorrow) {
          const s = await db.subjects.get(e.subjectId);
          await notify("Exam tomorrow", `${s?.name ?? "Exam"}${e.time ? ` at ${e.time}` : ""}. Open the exam-day kit.`, `exam-${e.id}-${d}`);
        }
      } catch {
        // storage or notifications unavailable; nothing to do
      } finally {
        running = false;
      }
    };
    check();
    const id = setInterval(check, 5 * 60_000);
    return () => clearInterval(id);
  }, []);
  return null;
}
