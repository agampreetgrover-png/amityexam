"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getSession, type SessionInfo } from "@/lib/auth/client";
import { ACCOUNT_FACTS } from "@/lib/auth/copy";
import { LogoMark } from "../logo";
import { cn } from "../ui";

// The frame every account screen sits in. It is the app's own welcome screen (components/mode-gate.tsx): the
// wordmark top left, a large heading, one muted line, then the content. These pages live outside the (app) group,
// so no browser database is opened and no app navigation is shown here.

export function Wordmark() {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5 rounded-lg text-[15px] font-semibold tracking-[-0.02em]">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-solid text-accent-ink" aria-hidden>
        <LogoMark size={17} />
      </span>
      Amity Exams
    </Link>
  );
}

/**
 * One column for the task (heading, form, links); on wide screens an optional second column carries what the
 * student should know before acting (what an account is, what changes). On phones it follows the form.
 */
export function AuthShell({ title, lead, children, aside, icon, wide }: { title: string; lead?: ReactNode; children: ReactNode; aside?: ReactNode; icon?: ReactNode; wide?: boolean }) {
  // Each screen moves focus to its heading when it appears, so a keyboard or screen-reader user lands on the new
  // screen (after "Send link", a failed check, an expired link…) instead of being left on a control that vanished.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <main className="min-h-dvh bg-bg px-4 pb-16 pt-6 sm:px-6 md:pt-8">
      {/* A form gets a narrow column; a screen that compares two things side by side (wide) gets room for both. */}
      <div className={cn("mx-auto w-full", aside ? "max-w-5xl" : wide ? "max-w-2xl" : "max-w-md")}>
        <Wordmark />
        <div className={cn("mt-10 md:mt-16", aside && "grid gap-12 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] lg:gap-20")}>
          {/* stagger: the icon, heading, lead and form rise in one after another. */}
          <div className="stagger min-w-0">
            {/* The same 40px tile as the app's other gate screens (profile-gate.tsx). */}
            {icon && (
              <div aria-hidden className="icon-pop mb-4 grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent">
                {icon}
              </div>
            )}
            <h1 ref={heading} tabIndex={-1} className="font-display text-[28px] leading-[1.1] tracking-[-0.02em] focus:outline-none md:text-[34px]">
              {title}
            </h1>
            {lead && <div className="mt-2 text-[15px] leading-relaxed text-muted">{lead}</div>}
            <div className="mt-7">{children}</div>
          </div>
          {/* On wide screens its first line sits level with the top of the form card. */}
          {aside && <aside className="min-w-0 lg:pt-24">{aside}</aside>}
        </div>
      </div>
    </main>
  );
}

/** The sheet a form sits on: the app's card, a little roomier. */
export function FormCard({ children, className }: { children: ReactNode; className?: string }) {
  // Hidden (space kept) while its fields are disabled because the server hasn't said yet whether accounts are on:
  // otherwise a form would flash up and then be replaced by "Accounts aren't available here".
  return <div className={cn("rounded-2xl border border-border bg-surface p-5 shadow-sheet has-[fieldset:disabled]:invisible sm:p-6", className)}>{children}</div>;
}

/** What an account is in this release, so nobody signs up expecting a backup. */
export function AccountFacts({ className }: { className?: string }) {
  return (
    <section aria-labelledby="account-facts" className={className}>
      <h2 id="account-facts" className="text-[15px] font-semibold tracking-[-0.01em]">
        How accounts work right now
      </h2>
      <dl className="mt-3 space-y-4">
        {ACCOUNT_FACTS.map((f) => (
          <div key={f.title}>
            <dt className="text-[14px] font-medium">{f.title}</dt>
            <dd className="mt-0.5 text-[14px] leading-relaxed text-muted">{f.body}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export type AccountsStatus =
  | { status: "checking" }
  | { status: "ready"; session: Extract<SessionInfo, { state: "signed-out" | "verified" }> }
  | { status: "off" }
  | { status: "unavailable" }
  | { status: "offline" };

/**
 * Asks the server once whether accounts are on and who (if anyone) is signed in. The answer is only used to choose
 * what to show; the server checks everything again on every request.
 */
export function useAccountsStatus(): AccountsStatus & { retry: () => void } {
  const [state, setState] = useState<AccountsStatus>({ status: "checking" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setState({ status: "checking" });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getSession().then((r) => {
      if (cancelled) return;
      if (!r.ok) {
        if (r.code === "offline") return setState({ status: "offline" });
        if (r.code === "not_available" || r.code === "disabled") return setState({ status: "off" });
        return setState({ status: "unavailable" });
      }
      const s = r.session;
      if (s.state === "disabled") return setState({ status: "off" });
      if (s.state === "unavailable") return setState({ status: "unavailable" });
      setState({ status: "ready", session: s });
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Back online: ask again rather than leaving the offline screen up.
  useEffect(() => {
    if (state.status !== "offline") return;
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [state.status, retry]);

  return { ...state, retry };
}
