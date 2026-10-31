import { useEffect, useSyncExternalStore } from "react";
import { THEME_KEY as KEY } from "./theme-script";

/** "system" follows the device; light and dark pin it. Kept in localStorage so it can apply before first paint. */
export type ThemeChoice = "system" | "light" | "dark";

const CHANGE = "themechange";
// Browser bar colour per theme, the same as --side (the sidebar), and as themeColor in layout.tsx.
const BAR = { light: "#ffffff", dark: "#0d0f17" };

const read = (): ThemeChoice => {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system"; // storage blocked: follow the device
  }
};
const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
const resolve = (c: ThemeChoice) => (c === "system" ? (systemDark() ? "dark" : "light") : c);

export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // not saved, but still applies for this visit
  }
  const root = document.documentElement;
  root.classList.add("theme-switching");
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
  // Two frames: the new colours paint without transitions, then transitions come back for everything else.
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
  window.dispatchEvent(new Event(CHANGE));
}

const subscribe = (fn: () => void) => {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  window.addEventListener(CHANGE, fn);
  window.addEventListener("storage", fn); // another tab changed it
  mq.addEventListener("change", fn);
  return () => {
    window.removeEventListener(CHANGE, fn);
    window.removeEventListener("storage", fn);
    mq.removeEventListener("change", fn);
  };
};

/** The saved choice and what it resolves to right now. Before hydration both read as light/system. */
export function useTheme() {
  const choice = useSyncExternalStore(subscribe, read, () => "system" as const);
  const resolved = useSyncExternalStore(subscribe, () => resolve(read()), () => "light" as const);
  // A change saved in another tab arrives here first, so the page follows it; and the browser's title bar
  // keeps to the theme actually showing, including a pinned one.
  // It reads storage itself: during hydration choice is still the server's "system", which would unpin it.
  useEffect(() => {
    const saved = read();
    const root = document.documentElement;
    if (saved === "system") delete root.dataset.theme;
    else root.dataset.theme = saved;
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
      m.content = BAR[resolve(saved)];
    });
  }, [choice, resolved]);
  return { choice, resolved };
}
