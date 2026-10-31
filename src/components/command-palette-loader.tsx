"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// Anything can open the palette (nav buttons, the top bar) by dispatching this event.
export const OPEN_EVENT = "open-command-palette";
export const openCommandPalette = () => window.dispatchEvent(new Event(OPEN_EVENT));

const CommandPalette = dynamic(() => import("./command-palette").then((m) => m.CommandPalette), { ssr: false });

/** Loads the Ctrl/Cmd+K palette the first time it's asked for, so pages that never open it don't load or query for it. */
export function CommandPaletteLoader() {
  const [wanted, setWanted] = useState(false);

  useEffect(() => {
    if (wanted) return; // once loaded, the palette listens for itself
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setWanted(true);
      }
    };
    const onOpen = () => setWanted(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [wanted]);

  return wanted ? <CommandPalette initialOpen /> : null;
}
