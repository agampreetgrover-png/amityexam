"use client";

import { useEffect, useState } from "react";
import { today } from "./dates";
import type { ISODay } from "./types";

/**
 * Today's date that moves on by itself. A bare today() is only re-read when the page happens to re-render,
 * so an app left open overnight (usual on a phone) would show yesterday's countdowns in the morning.
 */
export function useToday(): ISODay {
  const [t, setT] = useState(today);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      setT(today()); // same string = no re-render
      clearTimeout(timer);
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
      timer = setTimeout(refresh, midnight.getTime() - now.getTime());
    };
    // Timers are paused while a phone sleeps, so also check whenever the app comes back into view.
    const onVisible = () => document.visibilityState === "visible" && refresh();
    refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  return t;
}
