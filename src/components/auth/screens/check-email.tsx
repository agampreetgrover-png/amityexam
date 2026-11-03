"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { resendVerification, type AuthFailure } from "@/lib/auth/client";
import { errorMessage, formatWait } from "@/lib/auth/copy";
import { forgetPendingEmail, readPendingEmail } from "@/lib/auth/pending-email";
import { normalizeEmail, validateEmailOnly } from "@/lib/auth/validate";
import { SubmitButton, Notice } from "../feedback";
import { TextField } from "../fields";
import { AuthShell, FormCard, useAccountsStatus } from "../shell";
import { captchaOrFailure, useCaptcha } from "../turnstile";
import { RetryButton, StateScreen, UseLocalModeButton } from "../state-screen";
import { useAuthForm } from "../use-form";
import { forgotOutcome } from "./forgot-password";

export const RESEND_COOLDOWN_SECONDS = 60;

/** How long to hold the resend button after an answer: a minute after sending, or as long as the server asks. */
export function resendCooldown(outcome: "sent" | AuthFailure): number {
  if (outcome === "sent") return RESEND_COOLDOWN_SECONDS;
  if (outcome.code === "rate_limited") return outcome.retryAfter && outcome.retryAfter > 0 ? Math.ceil(outcome.retryAfter) : RESEND_COOLDOWN_SECONDS;
  return 0;
}

/** Whole seconds until `endsAt` (ms), never below zero. */
export const secondsLeft = (endsAt: number, now: number) => Math.max(0, Math.ceil((endsAt - now) / 1000));

export const resendLabel = (left: number) => (left > 0 ? `Send again in ${left}s` : "Send the link again");

// The pending address lives in this tab's sessionStorage, which the server render can't see: read it after hydration.
const noSubscribe = () => () => {};

/** /check-email: after signing up (or a sign-in that needs confirming), until the link in the email is opened. */
export function CheckEmailScreen() {
  const accounts = useAccountsStatus();
  const pending = useSyncExternalStore(noSubscribe, () => readPendingEmail(), () => null);

  if (accounts.status === "off") return <StateScreen kind="accounts-off" actions={<UseLocalModeButton primary label="Continue in Local Mode" />} />;
  if (accounts.status === "offline") return <StateScreen kind="offline" actions={<><RetryButton onClick={accounts.retry} /><UseLocalModeButton /></>} />;
  if (accounts.status === "unavailable") return <StateScreen kind="unavailable" actions={<><RetryButton onClick={accounts.retry} /><UseLocalModeButton /></>} />;

  return (
    <AuthShell
      title="Check your email"
      lead={
        pending ? (
          <>
            We sent a link to <strong className="font-medium text-text">{pending}</strong>. Open it to confirm your address.
          </>
        ) : (
          "If you've just created an account, we sent a link to confirm your email address. Open it to finish."
        )
      }
    >
      <p className="mb-5 text-[14px] leading-relaxed text-muted">
        The link works on any device, so you can open it on your phone. Can&apos;t find the email? Check your spam folder.
      </p>
      <ResendForm pending={pending} disabled={accounts.status === "checking"} />
      <div className="mt-6 space-y-2 text-[14px] text-muted">
        <p>
          Opened the link already?{" "}
          <Link href="/login" className="font-medium text-accent underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
        <p>
          Wrong address?{" "}
          <Link href="/signup" onClick={() => forgetPendingEmail()} className="font-medium text-accent underline-offset-4 hover:underline">
            Start again
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}

function ResendForm({ pending, disabled }: { pending: string | null; disabled: boolean }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  // Read out only when the wait starts and when it ends, never once a second.
  const [waitNote, setWaitNote] = useState("");

  const startCooldown = (seconds: number) => {
    setLeft(seconds);
    setEndsAt(Date.now() + seconds * 1000);
    setWaitNote(`You can send it again in ${formatWait(seconds)}.`);
  };

  // Arriving straight from sign-up, an email has only just been sent: wait the usual time before offering another,
  // instead of letting the first press run into the server's rate limit.
  const startedForPending = useRef(false);
  useEffect(() => {
    if (!pending || startedForPending.current) return;
    startedForPending.current = true;
    setLeft(RESEND_COOLDOWN_SECONDS);
    setEndsAt(Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
  }, [pending]);

  const captcha = useCaptcha("resend");
  const form = useAuthForm<"email", object>({
    validate: () => (pending ? {} : validateEmailOnly({ email })),
    submit: async () => {
      setSent(false);
      const c = captchaOrFailure(captcha.token);
      if (!("token" in c)) return c;
      const result = await resendVerification({ email: pending ?? normalizeEmail(email), captchaToken: c.token });
      captcha.reset(); // used up, whatever the answer
      // Always a generic answer: nothing shown here says whether an account uses the address.
      const outcome = forgotOutcome(result);
      const wait = resendCooldown(outcome);
      if (wait) startCooldown(wait);
      return outcome === "sent" ? { ok: true } : outcome;
    },
    onSuccess: () => setSent(true),
  });
  const f = form.failure;
  const { setFailure } = form;

  useEffect(() => {
    if (endsAt === null) return;
    const id = window.setInterval(() => {
      const l = secondsLeft(endsAt, Date.now());
      setLeft(l);
      if (l === 0) {
        window.clearInterval(id);
        setEndsAt(null);
        setWaitNote("You can send the link again now.");
        // A "too many attempts, wait" error is out of date once the wait is over.
        setFailure((prev) => (prev?.code === "rate_limited" ? null : prev));
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [endsAt, setFailure]);
  const coolingDown = left > 0;

  const feedback = (
    <>
      {sent && (
        <Notice tone="success" className="mt-5">
          If that address is waiting to be confirmed, a new link is on its way. Use the newest email.
        </Notice>
      )}
      {f && (
        <div id="resend-error" className="mt-5">
          <Notice tone="error">{errorMessage(f.code, f.retryAfter)}</Notice>
        </div>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {waitNote}
      </p>
    </>
  );
  const button = (
    <SubmitButton busy={form.busy} busyLabel="Sending…" disabled={disabled || coolingDown} className={pending ? "sm:w-auto sm:px-5" : "mt-6"}>
      {resendLabel(left)}
    </SubmitButton>
  );

  if (pending) {
    return (
      <form ref={form.formRef} noValidate onSubmit={form.onSubmit} aria-describedby={f ? "resend-error" : undefined}>
        {captcha.widget}
        <div className="mt-4">{button}</div>
        {feedback}
      </form>
    );
  }

  return (
    <FormCard>
      <form ref={form.formRef} noValidate onSubmit={form.onSubmit} aria-describedby={f ? "resend-error" : undefined}>
        <fieldset disabled={disabled} aria-busy={form.busy || undefined} className="space-y-4">
          <legend className="sr-only">Send the confirmation link again</legend>
          <TextField
            label="Email"
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            hint="The address you signed up with."
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              form.clearError("email");
            }}
            error={form.errors.email}
          />
        </fieldset>
        {captcha.widget}
        {feedback}
        {button}
      </form>
    </FormCard>
  );
}
