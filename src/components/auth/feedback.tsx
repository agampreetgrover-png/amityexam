"use client";

import { CircleAlert, CircleCheck, Info, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Button, cn } from "../ui";

// Feedback for the account screens: the submit button's busy state and the notices above or below a form.

/**
 * The form's main action. While the request runs it keeps its width, says what is happening ("Signing in…") and
 * can't be pressed twice. The spinner turns only when motion is allowed.
 */
export function SubmitButton({ busy, busyLabel, children, className, disabled }: { busy: boolean; busyLabel: string; children: ReactNode; className?: string; disabled?: boolean }) {
  // While busy it stays focusable (aria-disabled, not disabled): disabling the focused button would drop keyboard
  // focus to the page. A second press does nothing because the form ignores submits while one is running.
  return (
    <Button
      type="submit"
      disabled={disabled}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      className={cn("h-10 w-full text-[15px]", busy && "pointer-events-none", className)}
    >
      {busy ? (
        <>
          <LoaderCircle size={16} aria-hidden className="motion-safe:animate-spin" />
          {busyLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

type Tone = "error" | "info" | "success";
const tones: Record<Tone, { box: string; icon: ReactNode }> = {
  error: { box: "border-bad/25 bg-bad/[0.06] text-text", icon: <CircleAlert size={17} aria-hidden className="mt-px text-bad" /> },
  info: { box: "border-border bg-surface-2 text-text", icon: <Info size={17} aria-hidden className="mt-px text-accent" /> },
  success: { box: "border-good/25 bg-good/[0.07] text-text", icon: <CircleCheck size={17} aria-hidden className="mt-px text-good" /> },
};

/**
 * A notice tied to the form: an error from the server, a reason the student was sent here, or a success message.
 * Errors are announced as alerts; the others politely.
 */
export function Notice({ tone, title, children, className, action }: { tone: Tone; title?: string; children?: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex gap-3 rounded-xl border px-3.5 py-3 text-[14px] leading-relaxed", tones[tone].box, className)}>
      <span className="shrink-0">{tones[tone].icon}</span>
      <div className="min-w-0 space-y-0.5">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && "text-muted")}>{children}</div>}
        {action && <div className="pt-1.5">{action}</div>}
      </div>
    </div>
  );
}
