"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { AuthFailure } from "@/lib/auth/client";
import type { FieldErrors } from "@/lib/auth/validate";

// The submit cycle every account form shares: check the fields, focus the first wrong one, send once, and keep the
// server's answer. The form's own component decides what each answer means.

export type FormPhase = "idle" | "busy" | "done";

export function useAuthForm<K extends string, T>({
  validate,
  submit,
  onSuccess,
}: {
  validate: () => FieldErrors<K>;
  submit: () => Promise<({ ok: true } & T) | AuthFailure>;
  onSuccess?: (result: { ok: true } & T) => void;
}) {
  const [errors, setErrors] = useState<FieldErrors<K>>({});
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [phase, setPhase] = useState<FormPhase>("idle");
  const formRef = useRef<HTMLFormElement>(null);
  const [focusTick, setFocusTick] = useState(0);

  // After a failed check, move focus to the first field marked invalid so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (!focusTick) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusTick]);

  const onSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (phase === "busy") return;
      const found = validate();
      setErrors(found);
      setFailure(null);
      if (Object.keys(found).length) {
        setFocusTick((n) => n + 1);
        return;
      }
      setPhase("busy");
      const r = await submit();
      if (r.ok) {
        setPhase("done");
        onSuccess?.(r);
        return;
      }
      setPhase("idle");
      setFailure(r);
      if (r.field) {
        setErrors((prev) => ({ ...prev, [r.field as K]: prev[r.field as K] ?? "Check this field." }));
        setFocusTick((n) => n + 1);
      }
    },
    [phase, validate, submit, onSuccess],
  );

  /** Clears a field's error as soon as the student edits it. */
  const clearError = useCallback((k: K) => setErrors((prev) => (prev[k] ? { ...prev, [k]: undefined } : prev)), []);

  return { formRef, errors, failure, phase, busy: phase === "busy", onSubmit, clearError, setFailure };
}
