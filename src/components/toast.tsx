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

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

/** Shows a short confirmation, optionally with one action such as Undo. Disappears after 5 seconds. */
export function toast(message: string, action?: ToastItem["action"]) {
  const id = nextId++;
  // One at a time: a new confirmation replaces the last, so Undo always refers to the latest change.
  items = [{ id, message, action }];
  emit();
  setTimeout(() => dismissToast(id), 5000);
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
      className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex flex-col items-center gap-2 px-4 md:bottom-6 md:pl-64"
    >
      {list.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            "toast-in pointer-events-auto flex max-w-md items-center gap-4 rounded-xl bg-text py-2.5 pl-4 pr-2 text-sm text-white shadow-lg",
            !t.action && "pr-4",
          )}
        >
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              onClick={() => { t.action!.onClick(); dismissToast(t.id); }}
              className="rounded-lg px-2.5 py-1 font-semibold text-indigo-200 hover:bg-white/10 hover:text-white"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
