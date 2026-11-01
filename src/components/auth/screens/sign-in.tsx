"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { signIn, signOut } from "@/lib/auth/client";
import { errorMessage, LOCAL_MODE_LINE, SIGNED_OUT_NOTICE, signInNotice } from "@/lib/auth/copy";
import { PROFILE_CHANNEL } from "@/lib/profile";
import { rememberPendingEmail } from "@/lib/auth/pending-email";
import { normalizeEmail, validateSignIn } from "@/lib/auth/validate";
import { safeNext } from "@/lib/unlock-page";
import { Button, buttonClass } from "../../ui";
import { SubmitButton, Notice } from "../feedback";
import { PasswordField, TextField } from "../fields";
import { AuthShell, FormCard, useAccountsStatus } from "../shell";
import { RetryButton, StateScreen, UseLocalModeButton } from "../state-screen";
import { useAuthForm } from "../use-form";

/** /login. `?reason=` explains why the student was sent here; `?next=` is where to go once their data is open. */
export function SignInScreen() {
  const params = useSearchParams();
  const reason = params.get("reason");
  const next = safeNext(params.get("next"));
  const accounts = useAccountsStatus();

  if (accounts.status === "off") return <StateScreen kind="accounts-off" actions={<UseLocalModeButton primary label="Continue in Local Mode" />} />;
  if (accounts.status === "offline") return <StateScreen kind="offline" actions={<><RetryButton onClick={accounts.retry} /><UseLocalModeButton /></>} />;
  if (accounts.status === "unavailable") return <StateScreen kind="unavailable" actions={<><RetryButton onClick={accounts.retry} /><UseLocalModeButton /></>} />;
  if (accounts.status === "ready" && accounts.session.state === "verified") return <AlreadySignedIn email={accounts.session.user.email} userId={accounts.session.user.id} next={next} />;
  // Why the student is here: the link's ?reason=, or else what the server says about the last session.
  const notice = signInNotice(reason, accounts.status === "ready" && accounts.session.state === "signed-out" ? accounts.session.reason : null);

  return (
    <AuthShell title="Sign in" lead="Open your account's study data on this device.">
      {notice && (
        <Notice tone="info" title={SIGNED_OUT_NOTICE[notice].title} className="mb-5">
          {SIGNED_OUT_NOTICE[notice].body}
        </Notice>
      )}
      <SignInForm next={next} disabled={accounts.status === "checking"} />
      <p className="mt-6 text-[14px] text-muted">
        New to Amity Exams?{" "}
        <Link href="/signup" className="font-medium text-accent underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
      <div className="mt-8 border-t border-border pt-6">
        <p className="text-[14px] leading-relaxed text-muted">{LOCAL_MODE_LINE}</p>
        <div className="mt-3">
          <UseLocalModeButton label="Continue without an account" />
        </div>
      </div>
    </AuthShell>
  );
}

function SignInForm({ next, disabled }: { next: string; disabled: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const form = useAuthForm<"email" | "password", { userId: string; email: string }>({
    validate: () => validateSignIn({ email, password }),
    submit: () => signIn({ email: normalizeEmail(email), password }),
    // Signed in: the next screen asks before opening the account's data (D3); it never switches by itself.
    onSuccess: () => router.push(`/switch?next=${encodeURIComponent(next)}`),
  });
  const f = form.failure;
  const needsConfirm = f?.code === "email_not_confirmed";

  return (
    <FormCard>
      <form ref={form.formRef} noValidate onSubmit={form.onSubmit} aria-describedby={f ? "signin-error" : undefined}>
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
          <div className="space-y-1.5">
            <PasswordField
              label="Password"
              name="password"
              purpose="current"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                form.clearError("password");
              }}
              error={form.errors.password}
            />
            <Link href="/forgot-password" className="inline-block text-[13px] font-medium text-accent underline-offset-4 hover:underline">
              Forgot your password?
            </Link>
          </div>
        </fieldset>
        {f && (
          <div id="signin-error" className="mt-5">
            <Notice
              tone="error"
              action={
                needsConfirm ? (
                  <Link
                    href="/check-email"
                    onClick={() => rememberPendingEmail(normalizeEmail(email))}
                    className="text-[14px] font-medium text-accent underline-offset-4 hover:underline"
                  >
                    Send the confirmation link again
                  </Link>
                ) : undefined
              }
            >
              {errorMessage(f.code, f.retryAfter)}
            </Notice>
          </div>
        )}
        <SubmitButton busy={form.busy || form.phase === "done"} busyLabel={form.phase === "done" ? "Signed in" : "Signing in…"} disabled={disabled} className="mt-6">
          Sign in
        </SubmitButton>
      </form>
    </FormCard>
  );
}

/** Already signed in on this browser: offer to open that account's data, or to sign out, but do neither by itself. */
export function AlreadySignedIn({ email, userId, next }: { email: string | null; userId: string; next: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <AuthShell title="You're already signed in" lead={email ? <>Signed in as <strong className="font-medium text-text">{email}</strong>.</> : "This browser is signed in to an account."}>
      <div className="flex flex-wrap gap-2.5">
        <Link href={`/switch?next=${encodeURIComponent(next)}`} className={buttonClass("primary")}>
          Open this account&apos;s data
        </Link>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setFailed(null);
            const r = await signOut();
            if (r.ok) {
              // Other open tabs with this account's data close it (ProfileGate listens on this channel).
              try {
                const ch = new BroadcastChannel(PROFILE_CHANNEL);
                ch.postMessage({ type: "signed-out", userId: userId.toLowerCase() });
                ch.close();
              } catch {}
              return window.location.reload();
            }
            setBusy(false);
            setFailed(errorMessage(r.code, r.retryAfter));
          }}
        >
          {busy ? "Signing out…" : "Sign out"}
        </Button>
      </div>
      {failed && (
        <Notice tone="error" className="mt-5">
          {failed}
        </Notice>
      )}
    </AuthShell>
  );
}
