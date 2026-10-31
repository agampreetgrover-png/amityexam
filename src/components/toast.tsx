"use client";

import { useEffect, useState } from "react";
import { cn } from "./ui";

interface ToastItem {
  id: number;
  message: string;
  action?: { label: string; onClick: () => void };
}

// A tiny module-level store so any component can raise a toast without a provider.
let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<(t: ToastItem[]) => void>();
const emit = () => listeners.forEach((l) => l(items));

// One timer per toast, so hovering or focusing it can hold it on screen.
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const life = (t: ToastItem) => (t.action ? 10000 : 5000);
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
  items = items.filter((t) => t.id !== id);
  emit();
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
        "pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex flex-col items-center gap-2 px-4 md:bottom-6",
        // A chat composer on the page (marked data-composer) sits where the toast would; lift the toast above it.
        "[body:has([data-composer])_&]:bottom-[calc(9.5rem+env(safe-area-inset-bottom))] md:[body:has([data-composer])_&]:bottom-32",
      )}
    >
      {list.map((t) => (
        <div
          key={t.id}
          role="status"
          onMouseEnter={() => hold(t.id)}
          onMouseLeave={(e) => { if (!e.currentTarget.contains(document.activeElement)) arm(t); }}
          onFocus={() => hold(t.id)}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget) && !e.currentTarget.matches(":hover")) arm(t); }}
          className={cn(
            "toast-in pointer-events-auto flex max-w-md items-center gap-4 rounded-xl bg-text py-2 pl-4 pr-2 text-sm font-medium text-bg shadow-float",
            !t.action && "py-3 pr-4",
          )}
        >
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => { t.action!.onClick(); dismissToast(t.id); }}
              className="press shrink-0 rounded-lg px-3 py-1.5 font-semibold text-[var(--toast-action)] transition-colors duration-150 hover:bg-bg/10 focus-visible:outline-[var(--toast-action)]"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
