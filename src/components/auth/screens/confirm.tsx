"use client";

import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut, verifyEmailLink, type AuthFailure, type AuthResult, type VerifyType } from "@/lib/auth/client";
import { errorMessage } from "@/lib/auth/copy";
import { PROFILE_CHANNEL } from "@/lib/profile";
import { Button, buttonClass } from "../../ui";
import { Notice, SubmitButton } from "../feedback";
import { AuthShell, FormCard, useAccountsStatus, type AccountsStatus } from "../shell";
import { SignInLink, StateScreen, UseLocalModeButton } from "../state-screen";
import { useAuthForm } from "../use-form";

// /auth/confirm: where the links in our emails land. The email template should put the token in the fragment
// (/auth/confirm#token_hash=…&type=signup|email|recovery): a fragment never reaches the server, its logs, or the
// APP_PASSWORD unlock page. The query form (?token_hash=…) is accepted too.
// Email security scanners (common with university Outlook) open every link they see, so OPENING this page must not
// use the link: it only reads the address, then waits for the student to press the button. Nothing is sent on load,
// and the server-rendered page never contains or depends on the token (it is read in the browser, after load).

const TYPES: readonly VerifyType[] = ["signup", "email", "recovery"];
const TOKEN = /^[A-Za-z0-9_-]{1,512}$/;

export type ConfirmLink = { ok: true; tokenHash: string; type: VerifyType } | { ok: false; type: VerifyType | null };

/** Reads an email link's query. `type` is kept on a bad link when it was readable, to offer the right way to get a new one. */
export function parseConfirmLink(search: URLSearchParams | string): ConfirmLink {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const rawType = params.get("type");
  const type = TYPES.find((t) => t === rawType) ?? null;
  const tokenHash = params.get("token_hash");
  if (!type || !tokenHash || !TOKEN.test(tokenHash)) return { ok: false, type };
  return { ok: true, tokenHash, type };
}

/** The link from the address bar: the fragment when it carries one, otherwise the query. */
export function readLinkFromLocation(loc: { hash: string; search: string }): ConfirmLink {
  const hash = loc.hash.replace(/^#/, "");
  return parseConfirmLink(new URLSearchParams(hash).has("token_hash") ? hash : loc.search);
}

/** Where a fresh link comes from: the confirmation email can be sent again, a reset link is asked for again. */
const newLinkHref = (type: VerifyType | null) => (type === "signup" || type === "email" ? "/check-email" : "/forgot-password");

/** What the server's answer to "use this link" means for the screen. Exported for tests. */
export type ConfirmOutcome =
  | { kind: "reset-password" }
  | { kind: "confirmed" }
  | { kind: "expired" }
  | { kind: "invalid" }
  | { kind: "accounts-off" }
  /** Worth trying again from the same page: offline, the service is down, too many attempts. */
  | { kind: "retry"; message: string };

export function confirmOutcome(r: AuthResult<{ type?: VerifyType }>, linkType: VerifyType): ConfirmOutcome {
  if (r.ok) return (r.type ?? linkType) === "recovery" ? { kind: "reset-password" } : { kind: "confirmed" };
  switch (r.code) {
    case "link_expired":
      return { kind: "expired" };
    case "link_invalid":
      return { kind: "invalid" };
    case "not_available":
    case "disabled":
      return { kind: "accounts-off" };
    default:
      return { kind: "retry", message: errorMessage(r.code, r.retryAfter) };
  }
}

export function ConfirmScreen() {
  // Read once, in the browser, and kept here: the address bar is cleaned straight after.
  const [link, setLink] = useState<ConfirmLink | null>(null);
  useEffect(() => {
    setLink(readLinkFromLocation(window.location));
    // Don't leave the token in the address bar or history (a shared screenshot, a synced history entry).
    if (window.location.search || window.location.hash) window.history.replaceState(null, "", "/auth/confirm");
  }, []);

  if (!link) return <AuthShell title="Opening your link" lead="One moment.">{null}</AuthShell>;
  return <ConfirmView link={link} />;
}

/** The screen for a link already read from the address bar. Exported for tests. */
export function ConfirmView({ link }: { link: ConfirmLink }) {
  if (!link.ok) return <InvalidLink type={link.type} />;
  return <ConfirmLinkForm tokenHash={link.tokenHash} type={link.type} />;
}

function InvalidLink({ type }: { type: VerifyType | null }) {
  return (
    <StateScreen
      kind="link-invalid"
      actions={
        <>
          {/* Getting a working link is the way forward; signing in is the alternative. Same order as an expired link. */}
          <SignInLink href={newLinkHref(type)} label={type === "recovery" || type === null ? "Ask for a new link" : "Send a new link"} />
          <SignInLink primary={false} />
        </>
      }
    />
  );
}

/**
 * Whether using this link needs the student's explicit go-ahead first (M3: a link someone else sent must never
 * silently replace the account this browser is signed in to). The link's own account can't be known before it is
 * used (using it uses it up), so the question names the account that would be signed out:
 *   wait  the session check hasn't answered yet: the button stays disabled;
 *   ask   an account is signed in here (or the server said so: switch_required): ask, naming it when known;
 *   none  nobody is signed in here: use the link directly (the next screens name the account it opened).
 * Exported for tests.
 */
export type SwitchCheck = { kind: "wait" } | { kind: "none" } | { kind: "ask"; email: string | null; userId: string | null };

export function switchCheck(accounts: AccountsStatus, serverSaidSwitch: boolean): SwitchCheck {
  const signedIn = accounts.status === "ready" && accounts.session.state === "verified" ? accounts.session.user : null;
  if (signedIn) return { kind: "ask", email: signedIn.email, userId: signedIn.id };
  if (serverSaidSwitch) return { kind: "ask", email: null, userId: null };
  if (accounts.status === "checking") return { kind: "wait" };
  return { kind: "none" };
}

function ConfirmLinkForm({ tokenHash, type }: { tokenHash: string; type: VerifyType }) {
  const router = useRouter();
  const accounts = useAccountsStatus();
  const [outcome, setOutcome] = useState<ConfirmOutcome | null>(null);
  const [confirmedEmail, setConfirmedEmail] = useState<string | null>(null);
  const [serverSaidSwitch, setServerSaidSwitch] = useState(false);
  const check = switchCheck(accounts, serverSaidSwitch);
  const form = useAuthForm<never, { userId: string; email: string; type: VerifyType }>({
    validate: () => ({}),
    submit: async () => {
      // replaceSession only ever comes from the student pressing "Sign out and continue" on the question below.
      const replaceSession = check.kind === "ask";
      const r = await verifyEmailLink({ tokenHash, type, ...(replaceSession ? { replaceSession: true } : {}) });
      if (!r.ok && r.code === "switch_required") {
        // Signed in after all (e.g. the session check couldn't answer): ask first. The link wasn't used.
        setServerSaidSwitch(true);
        return { ok: false, code: "switch_required" };
      }
      if (r.ok && replaceSession && check.kind === "ask" && check.userId) announceSignedOut(check.userId);
      const o = confirmOutcome(r, type);
      // Failures that end the page are shown here; the ones worth retrying stay on the form (form.failure).
      if (!r.ok && o.kind !== "retry") setOutcome(o);
      return r;
    },
    onSuccess: (r) => {
      const o = confirmOutcome(r, type);
      // A reset link signs the student in for one thing only: choosing a new password (that screen names the account).
      if (o.kind === "reset-password") return router.replace("/reset-password");
      setConfirmedEmail(typeof r.email === "string" ? r.email : null);
      setOutcome(o);
    },
  });
  const recovery = type === "recovery";

  if (outcome?.kind === "confirmed") return <EmailConfirmed email={confirmedEmail} />;
  if (outcome?.kind === "invalid") return <InvalidLink type={type} />;
  if (outcome?.kind === "expired") {
    return (
      <StateScreen
        kind="link-expired"
        actions={
          <>
            <SignInLink href={newLinkHref(type)} label={recovery ? "Ask for a new link" : "Send a new link"} />
            <SignInLink primary={false} />
          </>
        }
      />
    );
  }
  if (outcome?.kind === "accounts-off") return <StateScreen kind="accounts-off" actions={<UseLocalModeButton primary label="Continue in Local Mode" />} />;

  // The server's switch_required is answered by the question itself, not shown as an error.
  const f = form.failure?.code === "switch_required" ? null : form.failure;
  if (check.kind === "ask") return <SwitchQuestion email={check.email} recovery={recovery} form={form} failure={f} />;
  return (
    <AuthShell
      title={recovery ? "Reset your password" : "Confirm your email"}
      lead={recovery ? "Use this link to choose a new password for your account." : "One last step to finish setting up your account."}
    >
      <FormCard>
        <form ref={form.formRef} noValidate onSubmit={form.onSubmit} aria-describedby={f ? "confirm-error" : undefined}>
          {f && (
            <div id="confirm-error" className="mb-5">
              <Notice tone="error">{errorMessage(f.code, f.retryAfter)}</Notice>
            </div>
          )}
          <SubmitButton busy={form.busy || form.phase === "done"} busyLabel="Confirming…" disabled={check.kind === "wait"}>
            {recovery ? "Continue to set a new password" : "Confirm email"}
          </SubmitButton>
          <p className="mt-4 text-[13px] leading-relaxed text-muted">This extra step stops email security scanners from using up your link.</p>
        </form>
      </FormCard>
    </AuthShell>
  );
}

/**
 * Asked before a link may replace the account this browser is signed in to. It names that account, says what
 * happens, and only "Sign out and continue" uses the link (with replaceSession). Exported for tests.
 */
export function SwitchQuestion({
  email,
  recovery,
  form,
  failure,
}: {
  email: string | null;
  recovery: boolean;
  form: Pick<ReturnType<typeof useAuthForm>, "formRef" | "onSubmit" | "busy" | "phase">;
  failure: AuthFailure | null;
}) {
  const who = email ? <strong className="font-medium text-text [overflow-wrap:anywhere]">{email}</strong> : "an account";
  return (
    <AuthShell title="Switch accounts?" lead={<>This browser is signed in to {who}.</>}>
      <FormCard>
        <form ref={form.formRef} noValidate onSubmit={form.onSubmit} aria-describedby={failure ? "switch-error" : undefined}>
          <p className="text-[14px] leading-relaxed text-muted">
            This link may belong to a different account. Only continue if you asked for it yourself. Continuing signs {who} out on this
            device and {recovery ? "lets you choose a new password for the account the link was sent to" : "signs in to the account the link was sent to"}. Data
            already on this device stays where it is.
          </p>
          {failure && (
            <div id="switch-error" className="mt-5">
              <Notice tone="error">{errorMessage(failure.code, failure.retryAfter)}</Notice>
            </div>
          )}
          <div className="mt-6 flex flex-wrap gap-2.5">
            <SubmitButton busy={form.busy || form.phase === "done"} busyLabel="Switching…" className="sm:w-auto sm:px-5">
              Sign out and continue
            </SubmitButton>
            <Link href="/" className={buttonClass("secondary")}>
              Stay signed in
            </Link>
          </div>
        </form>
      </FormCard>
    </AuthShell>
  );
}

/** Other open tabs with the replaced account's data close it (ProfileGate listens on this channel), as on sign-out. */
function announceSignedOut(userId: string) {
  try {
    const ch = new BroadcastChannel(PROFILE_CHANNEL);
    ch.postMessage({ type: "signed-out", userId: userId.toLowerCase() });
    ch.close();
  } catch {}
}

/** Names the address that was confirmed, so a link for someone else's account is noticed before anything opens. */
export function EmailConfirmed({ email }: { email: string | null }) {
  return (
    <AuthShell
      icon={<MailCheck size={18} />}
      title="Email confirmed"
      lead={
        <p className="max-w-md [overflow-wrap:anywhere]">
          {email ? <><strong className="font-medium text-text">{email}</strong> is confirmed. </> : "Your account is ready. "}
          Open it when you&apos;re ready; your Local Mode data stays separate.
        </p>
      }
    >
      <div className="flex flex-wrap gap-2.5">
        {/* /switch asks before opening anything: confirming an email never switches this browser's data. */}
        <Link href="/switch" className={buttonClass("primary")}>
          Open your account
        </Link>
        <UseLocalModeButton label="Stay in Local Mode" />
      </div>
      <NotMine />
    </AuthShell>
  );
}

/** M3: a link someone else sent signs this browser in to THEIR account; naming it is how that's noticed, and this undoes it. */
function NotMine() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <div className="mt-6 border-t border-border pt-5">
      <p className="text-[14px] leading-relaxed text-muted">Not your address? Sign out now; nothing on this device has been opened yet.</p>
      <Button
        variant="secondary"
        className="mt-3"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setFailed(null);
          const r = await signOut();
          if (r.ok) return window.location.assign("/login");
          setBusy(false);
          setFailed(errorMessage(r.code, r.retryAfter));
        }}
      >
        {busy ? "Signing out…" : "Sign out"}
      </Button>
      {failed && (
        <Notice tone="error" className="mt-4">
          {failed}
        </Notice>
      )}
    </div>
  );
}
