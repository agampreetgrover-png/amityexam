"use client";

import { useEffect } from "react";

/**
 * Dev only. `next dev` compiles a page the first time it's opened and doesn't prefetch links, so the first click
 * on each nav item waited 1-4 s. Once the app has settled, request each page in turn so it's compiled already.
 */
export function DevWarmup({ routes }: { routes: string[] }) {
  useEffect(() => {
    let stopped = false;
    const timer = setTimeout(async () => {
      for (const href of routes) {
        if (stopped) return;
        // The RSC header asks for the same payload a client-side navigation does.
        await fetch(href, { headers: { RSC: "1" } }).catch(() => {});
      }
    }, 1500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [routes]);
  return null;
}
