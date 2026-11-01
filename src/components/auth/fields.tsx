"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { passwordProgress } from "@/lib/auth/password-policy";
import { cn, Input } from "../ui";

// Form fields for the account screens. Each has a visible label, and its hint and error are tied to the input with
// aria-describedby so a screen reader reads them with the field. Errors show under the field in the "bad" ink, with
// the border turned to match (Input already does that for aria-invalid).

type Base = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "aria-invalid" | "aria-describedby"> & {
  label: string;
  error?: string;
  hint?: ReactNode;
};

function Messages({ hintId, errorId, hint, error }: { hintId: string; errorId: string; hint?: ReactNode; error?: string }) {
  return (
    <>
      {hint && (
        <span id={hintId} className="block text-[13px] leading-snug text-muted">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="block text-[13px] font-medium leading-snug text-bad">
          {error}
        </span>
      )}
    </>
  );
}

const describedBy = (hintId: string, errorId: string, hint?: ReactNode, error?: string) => [error && errorId, hint && hintId].filter(Boolean).join(" ") || undefined;

export function TextField({ label, error, hint, className, ...input }: Base) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-text/85">
        {label}
      </label>
      <Input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy(hintId, errorId, hint, error)} className={cn("h-10", className)} {...input} />
      <Messages hintId={hintId} errorId={errorId} hint={hint} error={error} />
    </div>
  );
}

type PasswordProps = Omit<Base, "type"> & {
  /** "new" shows the live length line under the field (sign-up, reset); "current" doesn't (signing in). */
  purpose: "new" | "current";
  /** For a confirm field: no length line of its own. */
  showRequirement?: boolean;
};

/**
 * A password field with a show/hide button inside it. Pasting and password managers always work: nothing here
 * blocks paste or sets autocomplete="off".
 */
export function PasswordField({ label, error, hint, purpose, showRequirement = purpose === "new", value, className, ...input }: PasswordProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const [visible, setVisible] = useState(false);
  const progress = showRequirement ? passwordProgress(typeof value === "string" ? value : "") : null;
  // The line itself isn't a live region: it changes on every keystroke and would talk over the typing echo. It is
  // read with the field (aria-describedby); a separate hidden status speaks once, when the length becomes enough.
  const requirement = progress ? <span className={cn(progress.met && "text-good")}>{progress.text}</span> : hint;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-text/85">
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={purpose === "new" ? "new-password" : "current-password"}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(hintId, errorId, requirement, error)}
          className={cn("h-10 pr-11", className)}
          {...input}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          // One signal for the state: a fixed name plus pressed/not pressed.
          aria-label={`Show ${label.toLowerCase()}`}
          aria-pressed={visible}
          aria-controls={id}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-lg text-muted transition-colors duration-150 hover:text-text focus-visible:outline-offset-[-2px]"
        >
          {visible ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
        </button>
      </div>
      <Messages hintId={hintId} errorId={errorId} hint={requirement} error={error} />
      {progress && (
        <span className="sr-only" role="status">
          {progress.met ? "Password is long enough." : ""}
        </span>
      )}
    </div>
  );
}
