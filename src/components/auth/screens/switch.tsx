"use client";

import { ArrowRight, CircleHelp, HardDrive, LoaderCircle, UserRound, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { signedOutState } from "@/lib/auth/copy";
import { openProfile, planSwitch, PROFILE_NOT_SAVED, readCurrentProfile, type CurrentProfile, type SwitchPlan } from "@/lib/auth/profile-switch";
import { safeNext } from "@/lib/unlock-page";
import { Button, buttonClass, cn } from "../../ui";
import { AccountFacts, AuthShell, useAccountsStatus } from "../shell";
import { Notice } from "../feedback";
import { ACTION, RetryButton, safeLocalStorage, SignInLink, StateScreen, UseLocalModeButton } from "../state-screen";

// /switch: shown after signing in and after confirming an email. The server says who is signed in; this browser
// remembers which profile's data it last opened. When they differ, nothing changes until the student presses
// "Open … data": never a switch by itself, and never a fall back to Local Mode by itself.

type ConfirmPlan = Extract<SwitchPlan, { kind: "confirm" }>;

export type ProfileCard = { icon: "local" | "account" | "unknown"; name: string; detail: string };

export type SwitchCopy = {
  lead: string;
  from: ProfileCard;
  to: ProfileCard;
  primaryLabel: string;
  /** Local Mode is already the stored profile, so "/" keeps it; from anything else, Local Mode has to be chosen. */
  secondary: { kind: "stay-local"; label: "Stay in Local Mode" } | { kind: "use-local"; label: "Use Local Mode instead" };
};

function fromCard(p: CurrentProfile): ProfileCard {
  if (p.kind === "local") return { icon: "local", name: "Local Mode", detail: "Data kept in this browser without an account" };
  if (p.kind === "user") return { icon: "account", name: "Another account", detail: "Its data stays on this device, closed" };
  return { icon: "unknown", name: "Unknown profile", detail: "This browser's profile setting couldn't be read" };
}

/** Every word the confirmation shows, from the plan. Pure, so the wording can be tested without a browser. */
export function switchCopy(plan: ConfirmPlan): SwitchCopy {
  const email = plan.to.email;
  return {
    lead: `${email ?? "This account"} is signed in, but its data isn't open in this browser yet.`,
    from: fromCard(plan.from),
    to: { icon: "account", name: email ?? "This account", detail: "Starts empty on this device if it's new" },
    // The email is already named twice above; repeated in the button it made a long, wrapping label.
    primaryLabel: "Open this account's data",
    secondary: plan.from.kind === "local" ? { kind: "stay-local", label: "Stay in Local Mode" } : { kind: "use-local", label: "Use Local Mode instead" },
  };
}

export function SwitchScreen() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const router = useRouter();
  const accounts = useAccountsStatus();

  // localStorage exists only in the browser: read it after mount, never while rendering on the server.
  const [current, setCurrent] = useState<CurrentProfile | null>(null);
  useEffect(() => {
    setCurrent(readCurrentProfile(safeLocalStorage()));
  }, []);

  const plan =
    accounts.status === "ready" && current ? planSwitch(current, accounts.session.state === "verified" ? accounts.session.user : null) : null;
  const alreadyOpen = plan?.kind === "already-open";

  // Opening the account that is already open isn't a switch: carry on to where the student was going.
  useEffect(() => {
    if (alreadyOpen) router.replace(next);
  }, [alreadyOpen, next, router]);

  if (accounts.status === "off") return <StateScreen kind="accounts-off" actions={<UseLocalModeButton primary label="Continue in Local Mode" />} />;
  if (accounts.status === "offline") return <StateScreen kind="offline" actions={<><RetryButton onClick={accounts.retry} /><UseLocalModeButton /></>} />;
  if (accounts.status === "unavailable") return <StateScreen kind="unavailable" actions={<><RetryButton onClick={accounts.retry} /><UseLocalModeButton /></>} />;

  if (plan?.kind === "no-account") {
    // Why nobody is signed in, as the server put it: a deleted or banned account, an expired session, or simply
    // no sign-in at all (then someone who was using Local Mode isn't told they were "signed out").
    const reason = accounts.status === "ready" && accounts.session.state === "signed-out" ? accounts.session.reason : "none";
    return (
      <StateScreen
        kind={signedOutState(reason, current?.kind === "user")}
        actions={
          <>
            <SignInLink href={`/login?next=${encodeURIComponent(next)}`} />
            <UseLocalModeButton />
          </>
        }
      />
    );
  }
  if (plan?.kind === "already-open") {
    return (
      <AuthShell title="Your account is already open">
        <p role="status" className="text-[15px] text-muted">
          Opening your account…
        </p>
      </AuthShell>
    );
  }
  if (plan?.kind === "confirm") return <SwitchConfirmation plan={plan} next={next} />;
  return <Checking />;
}

/** Waiting for the server: a quiet line, and only if the answer takes long enough to notice. */
function Checking() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 400);
    return () => clearTimeout(t);
  }, []);
  return (
    <AuthShell title="Checking your sign-in">
      {/* The live region is there from the start, so the line is announced when it appears. */}
      <p role="status" className="text-[15px] text-muted">
        {show ? "Checking who's signed in on this browser…" : ""}
      </p>
    </AuthShell>
  );
}

const ICONS: Record<ProfileCard["icon"], LucideIcon> = { local: HardDrive, account: UserRound, unknown: CircleHelp };

// Each side of the comparison is a sheet with a plain heading set like the forms' field labels (not a small grey
// tag above it), and the profile's icon inline with its name: the icon tells Local Mode from an account at a glance.
function ProfilePanel({ id, label, card, target = false }: { id: string; label: string; card: ProfileCard; target?: boolean }) {
  const Icon = ICONS[card.icon];
  return (
    <section aria-labelledby={id} className={cn("min-w-0 rounded-2xl border bg-surface p-4 shadow-sheet sm:p-5", target ? "border-accent/40" : "border-border")}>
      <h2 id={id} className="text-[13px] font-medium text-text/85">
        {label}
      </h2>
      <p className="mt-2 flex items-start gap-2 text-[15px] font-medium leading-snug">
        <Icon aria-hidden size={16} className={cn("mt-[3px] shrink-0", target ? "text-accent" : "text-muted")} />
        <span className="min-w-0 [overflow-wrap:anywhere]">{breakableEmail(card.name)}</span>
      </p>
      <p className="mt-1 text-[14px] leading-relaxed text-muted">{card.detail}</p>
    </section>
  );
}

/** The confirmation itself: which data is open now, which would open, what an account is, and the choice. */
export function SwitchConfirmation({ plan, next }: { plan: ConfirmPlan; next: string }) {
  const copy = switchCopy(plan);
  const [busy, setBusy] = useState(false);
  const [notSaved, setNotSaved] = useState(false);

  const open = () => {
    if (busy) return;
    setBusy(true);
    setNotSaved(false);
    // Remembers the account as this browser's profile and loads the app fresh; the profile gate opens its data.
    // If the choice can't be saved nothing is opened (it would fall back to whatever was stored): say so instead.
    if (!openProfile({ kind: "user", userId: plan.to.userId }, { storage: safeLocalStorage(), go: (u) => window.location.assign(u) }, next)) {
      setBusy(false);
      setNotSaved(true);
    }
  };

  return (
    <AuthShell wide title="Open your account's data?" lead={<p className="[overflow-wrap:anywhere]">{copy.lead}</p>}>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-3">
        <ProfilePanel id="switch-from" label="Open now" card={copy.from} />
        <ArrowRight aria-hidden size={16} className="rotate-90 place-self-center text-faint sm:rotate-0" />
        <ProfilePanel id="switch-to" label="Will open" card={copy.to} target />
      </div>

      <AccountFacts className="mt-8" />

      {notSaved && (
        <Notice tone="error" className="mt-8">
          {PROFILE_NOT_SAVED}
        </Notice>
      )}
      <div className="mt-8 flex flex-wrap gap-2.5">
        <Button onClick={open} aria-disabled={busy || undefined} aria-busy={busy || undefined} className={cn(ACTION, "max-w-full", busy && "pointer-events-none")}>
          {busy ? (
            <>
              <LoaderCircle size={16} aria-hidden className="motion-safe:animate-spin" />
              Opening…
            </>
          ) : (
            <span className="min-w-0 [overflow-wrap:anywhere]">{copy.primaryLabel}</span>
          )}
        </Button>
        {copy.secondary.kind === "stay-local" ? (
          <Link href="/" className={buttonClass("secondary", "md", ACTION)}>
            {copy.secondary.label}
          </Link>
        ) : (
          <UseLocalModeButton label={copy.secondary.label} />
        )}
      </div>
      <p className="mt-5 text-[14px]">
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-accent underline-offset-4 hover:underline">
          Sign in with a different account
        </Link>
      </p>
    </AuthShell>
  );
}

/** An address may wrap after "@" or a dot instead of in the middle of a word on a narrow screen. */
function breakableEmail(text: string) {
  if (!text.includes("@")) return text;
  return text.split(/(?<=[@.])/).map((part, i) => (
    <Fragment key={i}>
      {i > 0 && <wbr />}
      {part}
    </Fragment>
  ));
}
