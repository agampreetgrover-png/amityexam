"use client";

import { useEffect, useState } from "react";
import { cn } from "./ui";

interface ToastItem {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
  /** Fading out: still drawn for a moment, but no longer pressable. */
  leaving?: boolean;
}

// A tiny module-level store so any component can raise a toast without a provider.
let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<(t: ToastItem[]) => void>();
const emit = () => listeners.forEach((l) => l(items));

// One timer per toast, so hovering or focusing it can hold it on screen.
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const life = (t: ToastItem) => (t.action ? 10000 : 5000);
// Leaving is quicker than arriving (200ms, .toast-in).
const EXIT_MS = 150;
function arm(t: ToastItem) {
  clearTimeout(timers.get(t.id));
  timers.set(t.id, setTimeout(() => dismissToast(t.id), life(t)));
}
function hold(id: number) {
  clearTimeout(timers.get(id));
  timers.delete(id);
}

function dismissToast(id: number) {
  hold(id);
  if (!items.some((t) => t.id === id && !t.leaving)) return;
  items = items.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  emit();
  setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, EXIT_MS);
}

/**
 * Shows a short confirmation, optionally with one action such as Undo. Disappears after 5 seconds, 10 with an
 * action; paused while hovered or focused.
 */
export function toast(message: string, action?: ToastItem["action"]) {
  const id = nextId++;
  // One at a time: a new confirmation replaces the last, so Undo always refers to the latest change.
  items.forEach((t) => hold(t.id));
  const item = { id, message, action };
  items = [item];
  emit();
  arm(item);
  return id;
}

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items);
  useEffect(() => {
    listeners.add(setList);
    return () => { listeners.delete(setList); };
  }, []);
  return (
    <div
      aria-live="polite"
      className={cn(
        // Phones: just above the bottom bar. Wider: centred on the page column, clear of the sidebar (its icon rail, then its wide form).
        "pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex flex-col items-center gap-2 px-4 md:bottom-6 md:pl-[calc(5rem+env(safe-area-inset-left))] lg:pl-[calc(17rem+env(safe-area-inset-left))]",
        // A chat composer on the page (marked data-composer) sits where the toast would; lift the toast above it.
        "[body:has([data-composer])_&]:bottom-[calc(12rem+env(safe-area-inset-bottom))] md:[body:has([data-composer])_&]:bottom-44",
      )}
    >
      {list.map((t) => (
        <div
          key={t.id}
          role="status"
          // While it fades out it is gone for keyboards and screen readers too, so Enter can't press Undo a second time.
          inert={t.leaving}
          onMouseEnter={() => hold(t.id)}
          onMouseLeave={(e) => { if (!t.leaving && !e.currentTarget.contains(document.activeElement)) arm(t); }}
          onFocus={() => hold(t.id)}
          onBlur={(e) => { if (!t.leaving && !e.currentTarget.contains(e.relatedTarget) && !e.currentTarget.matches(":hover")) arm(t); }}
          className={cn(
            "toast-in pointer-events-auto flex min-h-11 w-fit max-w-full items-center gap-4 rounded-xl bg-text py-1.5 pl-4 pr-1.5 text-sm font-medium text-bg shadow-float transition-[opacity,translate] duration-150 ease-snappy sm:max-w-md",
            !t.action && "py-2.5 pr-4",
            t.leaving && "pointer-events-none translate-y-1 opacity-0",
          )}
        >
          <span className="min-w-0 py-1 leading-snug">{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => { if (t.leaving) return; t.action!.onClick(); dismissToast(t.id); }}
              // Taller on touch screens, so Undo is an easy thumb target.
              className="press h-8 shrink-0 rounded-lg px-3 font-semibold text-[var(--toast-action)] hover:bg-bg/10 focus-visible:outline-[var(--toast-action)] pointer-coarse:h-9"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
