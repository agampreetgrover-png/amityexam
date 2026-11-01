"use client";

import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { updatePassword, type AuthFailure } from "@/lib/auth/client";
import { errorMessage } from "@/lib/auth/copy";
import { validateNewPassword } from "@/lib/auth/validate";
import { buttonClass } from "../../ui";
import { SubmitButton, Notice } from "../feedback";
import { PasswordField } from "../fields";
import { AuthShell, FormCard, useAccountsStatus } from "../shell";
import { RetryButton, SignInLink, StateScreen, UseLocalModeButton } from "../state-screen";
import { useAuthForm } from "../use-form";

/**
 * Where a failed save shows up: the session is gone (the recovery link's sign-in ended, so the link counts as
 * expired), the password itself was refused (on the field), or anything else (a notice under the form).
 */
export function resetFailureView(f: AuthFailure): "expired" | "password" | "notice" {
  if (f.code === "session_missing") return "expired";
  if (f.code === "weak_password" || f.code === "same_password") return "password";
  return "notice";
}

const PASSWORD_REFUSED: Partial<Record<AuthFailure["code"], string>> = {
  weak_password: "Too short or too commonly used.",
  same_password: "That's your current password.",
};

/** /reset-password: reached from the recovery link, once the server has confirmed it and signed the student in. */
export function ResetPasswordScreen() {
  const accounts = useAccountsStatus();
  const [result, setResult] = useState<"form" | "done" | "expired">("form");

  if (result === "done") return <PasswordChanged />;
  if (result === "expired") return <LinkExpired />;
  if (accounts.status === "off") return <StateScreen kind="accounts-off" actions={<UseLocalModeButton primary label="Continue in Local Mode" />} />;
  if (accounts.status === "offline") return <StateScreen kind="offline" actions={<><RetryButton onClick={accounts.retry} /><UseLocalModeButton /></>} />;
  if (accounts.status === "unavailable") return <StateScreen kind="unavailable" actions={<><RetryButton onClick={accounts.retry} /><UseLocalModeButton /></>} />;
  // Nobody is signed in: the link's sign-in has ended or never happened, so there is no account to change.
  if (accounts.status === "ready" && accounts.session.state === "signed-out") return <LinkExpired />;

  const user = accounts.status === "ready" && accounts.session.state === "verified" ? accounts.session.user : null;
  return (
    <AuthShell
      title="Choose a new password"
      lead={user?.email ? <>For <strong className="font-medium text-text">{user.email}</strong>.</> : "Pick something you haven't used for this account before."}
    >
      <ResetForm userId={user?.id ?? null} onDone={() => setResult("done")} onExpired={() => setResult("expired")} />
    </AuthShell>
  );
}

function ResetForm({ userId, onDone, onExpired }: { userId: string | null; onDone: () => void; onExpired: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const form = useAuthForm<"password" | "confirm", object>({
    validate: () => validateNewPassword({ password, confirm }),
    submit: async () => {
      if (!userId) return { ok: false, code: "session_missing" };
      // The server only changes the password if the signed-in account is still the one this page was opened for.
      const r = await updatePassword({ password, expectedUserId: userId });
      if (!r.ok && resetFailureView(r) === "expired") onExpired();
      return r;
    },
    onSuccess: onDone,
  });
  const f = form.failure;
  const view = f ? resetFailureView(f) : null;
  const refused = f && view === "password" ? PASSWORD_REFUSED[f.code] : undefined;
  const { formRef } = form;

  // A refused password: put the student back in the field to change it.
  useEffect(() => {
    if (refused) formRef.current?.querySelector<HTMLInputElement>('input[name="password"]')?.focus();
  }, [refused, formRef]);

  return (
    <FormCard>
      <form ref={form.formRef} noValidate onSubmit={form.onSubmit} aria-describedby={f ? "reset-error" : undefined}>
        <fieldset disabled={!userId} aria-busy={form.busy || undefined} className="space-y-4">
          <legend className="sr-only">Your new password</legend>
          <PasswordField
            label="New password"
            name="password"
            purpose="new"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              form.clearError("password");
              if (refused) form.setFailure(null);
            }}
            error={refused ?? form.errors.password}
          />
          <PasswordField
            label="Confirm new password"
            name="confirm"
            purpose="new"
            showRequirement={false}
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              form.clearError("confirm");
            }}
            error={form.errors.confirm}
          />
        </fieldset>
        {/* A refused password is already explained under its field; the notice is for everything else. */}
        {f && view === "notice" && (
          <div id="reset-error" className="mt-5">
            <Notice tone="error">{errorMessage(f.code, f.retryAfter)}</Notice>
          </div>
        )}
        <SubmitButton busy={form.busy || form.phase === "done"} busyLabel="Saving…" disabled={!userId} className="mt-6">
          Save new password
        </SubmitButton>
      </form>
    </FormCard>
  );
}

export function LinkExpired() {
  return (
    <StateScreen
      kind="link-expired"
      actions={
        <>
          <Link href="/forgot-password" className={buttonClass("primary")}>
            Ask for a new link
          </Link>
          <SignInLink primary={false} />
        </>
      }
    />
  );
}

export function PasswordChanged() {
  return (
    <AuthShell
      icon={<CircleCheck size={18} />}
      title="Password changed"
      lead={<p className="max-w-md">Use your new password next time you sign in. Other devices signed in to this account have been signed out.</p>}
    >
      <Link href="/switch" className={buttonClass("primary")}>
        Open your account
      </Link>
    </AuthShell>
  );
}
