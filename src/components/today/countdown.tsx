"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "../ui";

// How far above the real figure the count starts: 4 days counts 19, 18 … 4.
const LEAD = 15;
// Wait before the first tick, while the card is still rising in.
const HOLD_MS = 180;
// The gap before tick k (1…LEAD): fast at first, slowing like a reel settling. About 1.5s in all.
const gap = (k: number) => 28 + 260 * (k / LEAD) ** 3;

type Phase = "rest" | "counting" | "landed";

/**
 * Where the count starts for a figure of `days`, or null when it isn't counted. On the exam day itself (0) the
 * figure is the word "Today", which a run of numbers ticking down to 1 doesn't lead to, so it is just shown.
 */
export const countStart = (days: number): number | null => (days > 0 ? days + LEAD : null);

/**
 * The next exam's days-left figure. The first time it is shown in a visit (per exam, per day) it counts down to the
 * real number from LEAD above it; after that, under reduced motion, and on the exam day, it just shows the figure.
 * Screen readers get the real figure only, never the ticks.
 */
export function CountdownFigure({ days, playKey, markClass }: { days: number; playKey: string; markClass?: string }) {
  const [shown, setShown] = useState(days);
  const [phase, setPhase] = useState<Phase>("rest");
  const [tick, setTick] = useState(0); // the current tick's animation length

  // Layout effect: the starting number replaces the real one before the first paint, so the real one never flashes.
  const done = useRef(false);
  useLayoutEffect(() => {
    const from = countStart(days);
    if (from === null || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const key = `countdown:${playKey}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Storage blocked (a private window): play it every time rather than never.
    }
    done.current = false;
    let k = 0;
    let timer: ReturnType<typeof setTimeout>;
    setShown(from);
    setPhase("counting");
    const step = () => {
      k += 1;
      const next = from - k;
      if (next <= days) {
        done.current = true;
        setShown(days);
        setPhase("landed");
        return;
      }
      setShown(next);
      setTick(Math.min(220, gap(k + 1) * 0.9));
      timer = setTimeout(step, gap(k + 1));
    };
    timer = setTimeout(step, HOLD_MS + gap(1));
    return () => {
      clearTimeout(timer);
      if (done.current) return;
      // Stopped part-way (the page left, or React's development double run): show the real figure and let the
      // next showing play it in full.
      try { sessionStorage.removeItem(key); } catch {}
      setShown(days);
      setPhase("rest");
    };
  }, [days, playKey]);

  const real = days === 0 ? "Today" : String(days);
  if (phase !== "counting") {
    return <span className={cn(markClass, phase === "landed" && "count-land")}>{real}</span>;
  }
  return (
    <>
      <span className="sr-only">{real}</span>
      {/* The final figure holds the space, so the card's columns keep the width they will have once it lands.
          The ticking number lies over it, left-aligned; a wider starting number reaches into the gap beside it. */}
      <span aria-hidden className="relative inline-block">
        {/* It carries the urgency mark too, so the room the figure keeps for its underline is there from the start. */}
        <span className={cn("invisible", markClass)}>{real}</span>
        {/* One reel per digit. A digit that is the same as on the last tick keeps its element and stays still (the 1
            of 19, 18, 17…); only a digit that changed is a new element, and it rolls down into its window. */}
        <span className="absolute left-0 top-0 flex whitespace-nowrap">
          {[...String(shown)].map((ch, i) => (
            <span key={`${i}:${ch}`} className="count-reel">
              <span className={cn("inline-block", tick > 0 && String(shown + 1)[i] !== ch && "count-tick")} style={{ animationDuration: `${tick}ms` }}>{ch}</span>
            </span>
          ))}
        </span>
      </span>
    </>
  );
}
