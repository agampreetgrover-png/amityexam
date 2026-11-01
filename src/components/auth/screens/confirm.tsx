"use client";

import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { verifyEmailLink, type AuthResult, type VerifyType } from "@/lib/auth/client";
import { errorMessage } from "@/lib/auth/copy";
import { buttonClass } from "../../ui";
import { Notice, SubmitButton } from "../feedback";
import { AuthShell, FormCard } from "../shell";
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

function ConfirmLinkForm({ tokenHash, type }: { tokenHash: string; type: VerifyType }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<ConfirmOutcome | null>(null);
  const [confirmedEmail, setConfirmedEmail] = useState<string | null>(null);
  const form = useAuthForm<never, { userId: string; email: string; type: VerifyType }>({
    validate: () => ({}),
    submit: async () => {
      const r = await verifyEmailLink({ tokenHash, type });
      const o = confirmOutcome(r, type);
      // Failures that end the page are shown here; the ones worth retrying stay on the form (form.failure).
      if (!r.ok && o.kind !== "retry") setOutcome(o);
      return r;
    },
    onSuccess: (r) => {
      const o = confirmOutcome(r, type);
      // A reset link signs the student in for one thing only: choosing a new password.
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

  const f = form.failure;
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
          <SubmitButton busy={form.busy || form.phase === "done"} busyLabel="Confirming…">
            {recovery ? "Continue to set a new password" : "Confirm email"}
          </SubmitButton>
          <p className="mt-4 text-[13px] leading-relaxed text-muted">This extra step stops email security scanners from using up your link.</p>
        </form>
      </FormCard>
    </AuthShell>
  );
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
    </AuthShell>
  );
}
