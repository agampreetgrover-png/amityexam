"use client";

import Link from "next/link";
import { useState } from "react";
import { requestPasswordReset, type AuthErrorCode, type AuthFailure, type AuthResult } from "@/lib/auth/client";
import { errorMessage } from "@/lib/auth/copy";
import { normalizeEmail, validateEmailOnly } from "@/lib/auth/validate";
import { SubmitButton, Notice } from "../feedback";
import { TextField } from "../fields";
import { AuthShell, FormCard, useAccountsStatus } from "../shell";
import { RetryButton, SignInLink, StateScreen, UseLocalModeButton } from "../state-screen";
import { useAuthForm } from "../use-form";

/**
 * Failures worth telling the student about: the request didn't reach the service, or the service said "not now".
 * None of them says anything about whether an account exists.
 */
const TRANSPORT_FAILURES = new Set<AuthErrorCode>(["offline", "network", "rate_limited", "unavailable", "disabled", "not_available", "blocked"]);

/**
 * What a "send me a link" request (reset or confirmation) shows. Anything that isn't a transport or availability
 * problem reads as "sent", the same as success, so the answer never reveals whether an account uses the address.
 */
export function forgotOutcome(result: AuthResult<object>): "sent" | AuthFailure {
  if (result.ok) return "sent";
  return TRANSPORT_FAILURES.has(result.code) ? result : "sent";
}

/** /forgot-password: ask for a link to choose a new password. */
export function ForgotPasswordScreen() {
  const accounts = useAccountsStatus();
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (accounts.status === "off") return <StateScreen kind="accounts-off" actions={<UseLocalModeButton primary label="Continue in Local Mode" />} />;
  if (accounts.status === "offline") return <StateScreen kind="offline" actions={<><RetryButton onClick={accounts.retry} /><UseLocalModeButton /></>} />;
  if (accounts.status === "unavailable") return <StateScreen kind="unavailable" actions={<><RetryButton onClick={accounts.retry} /><UseLocalModeButton /></>} />;

  if (sentTo) return <ForgotSent email={sentTo} />;

  return (
    <AuthShell title="Reset your password" lead="Enter the email you signed up with and we'll send you a link to choose a new password.">
      <ForgotForm disabled={accounts.status === "checking"} onSent={setSentTo} />
      <p className="mt-6 text-[14px] text-muted">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-accent underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}

/** The same answer whether or not an account uses the address. */
export function ForgotSent({ email }: { email: string }) {
  return (
    <AuthShell title="Check your email" lead="Open the link in the email to choose a new password.">
      <Notice tone="success">
        If an account uses <strong className="font-medium">{email}</strong>, we&apos;ve sent it a link to reset the password. The link works once and expires soon.
      </Notice>
      <p className="mt-5 text-[14px] leading-relaxed text-muted">Didn&apos;t get it? Check spam, or try again in a few minutes.</p>
      <div className="mt-6">
        <SignInLink label="Back to sign in" primary={false} />
      </div>
    </AuthShell>
  );
}

function ForgotForm({ disabled, onSent }: { disabled: boolean; onSent: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const form = useAuthForm<"email", object>({
    validate: () => validateEmailOnly({ email }),
    submit: async () => {
      const outcome = forgotOutcome(await requestPasswordReset({ email: normalizeEmail(email) }));
      return outcome === "sent" ? { ok: true } : outcome;
    },
    onSuccess: () => onSent(normalizeEmail(email)),
  });
  const f = form.failure;

  return (
    <FormCard>
      <form ref={form.formRef} noValidate onSubmit={form.onSubmit} aria-describedby={f ? "forgot-error" : undefined}>
        <fieldset disabled={disabled} aria-busy={form.busy || undefined} className="space-y-4">
          <legend className="sr-only">Your account</legend>
          <TextField
            label="Email"
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              form.clearError("email");
            }}
            error={form.errors.email}
          />
        </fieldset>
        {f && (
          <div id="forgot-error" className="mt-5">
            <Notice tone="error">{errorMessage(f.code, f.retryAfter)}</Notice>
          </div>
        )}
        <SubmitButton busy={form.busy || form.phase === "done"} busyLabel="Sending link…" disabled={disabled} className="mt-6">
          Send link
        </SubmitButton>
      </form>
    </FormCard>
  );
}
