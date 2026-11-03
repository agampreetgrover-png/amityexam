"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signUp } from "@/lib/auth/client";
import { errorMessage } from "@/lib/auth/copy";
import { rememberPendingEmail } from "@/lib/auth/pending-email";
import { normalizeEmail, validateSignUp } from "@/lib/auth/validate";
import { SubmitButton, Notice } from "../feedback";
import { PasswordField, TextField } from "../fields";
import { AccountFacts, AuthShell, FormCard, useAccountsStatus } from "../shell";
import { captchaOrFailure, useCaptcha } from "../turnstile";
import { RetryButton, StateScreen, UseLocalModeButton } from "../state-screen";
import { useAuthForm } from "../use-form";
import { AlreadySignedIn } from "./sign-in";

/** /signup. The server answers the same for a new and an existing address, so this screen never says which it was. */
export function SignUpScreen() {
  const accounts = useAccountsStatus();

  if (accounts.status === "off") return <StateScreen kind="accounts-off" actions={<UseLocalModeButton primary label="Continue in Local Mode" />} />;
  if (accounts.status === "offline") return <StateScreen kind="offline" actions={<><RetryButton onClick={accounts.retry} /><UseLocalModeButton /></>} />;
  if (accounts.status === "unavailable") return <StateScreen kind="unavailable" actions={<><RetryButton onClick={accounts.retry} /><UseLocalModeButton /></>} />;
  if (accounts.status === "ready" && accounts.session.state === "verified") return <AlreadySignedIn email={accounts.session.user.email} userId={accounts.session.user.id} next="/" />;

  return (
    <AuthShell title="Create an account" lead="Keep your study data separate from Local Mode on this device." aside={<AccountFacts />}>
      <SignUpForm disabled={accounts.status === "checking"} />
      <p className="mt-6 text-[14px] text-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}

function SignUpForm({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const captcha = useCaptcha("signup");
  const form = useAuthForm<"email" | "password" | "confirm", object>({
    validate: () => validateSignUp({ email, password, confirm }),
    submit: async () => {
      const c = captchaOrFailure(captcha.token);
      if (!("token" in c)) return c;
      const r = await signUp({ email: normalizeEmail(email), password, captchaToken: c.token });
      captcha.reset(); // used up, whatever the answer
      return r;
    },
    onSuccess: () => {
      // Only the address goes along (this tab's sessionStorage), so /check-email can offer to send the link again.
      rememberPendingEmail(normalizeEmail(email));
      router.push("/check-email");
    },
  });
  const f = form.failure;

  return (
    <FormCard>
      <form ref={form.formRef} noValidate onSubmit={form.onSubmit} aria-describedby={f ? "signup-error" : undefined}>
        <fieldset disabled={disabled} aria-busy={form.busy || undefined} className="space-y-4">
          <legend className="sr-only">Your new account</legend>
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
          <PasswordField
            label="Password"
            name="password"
            purpose="new"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              form.clearError("password");
            }}
            error={form.errors.password}
          />
          <PasswordField
            label="Confirm password"
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
        {captcha.widget}
        {f && (
          <div id="signup-error" className="mt-5">
            <Notice tone="error">{errorMessage(f.code, f.retryAfter)}</Notice>
          </div>
        )}
        <SubmitButton busy={form.busy || form.phase === "done"} busyLabel="Creating account…" disabled={disabled} className="mt-6">
          Create account
        </SubmitButton>
      </form>
    </FormCard>
  );
}
