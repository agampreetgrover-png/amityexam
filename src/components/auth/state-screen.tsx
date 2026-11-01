"use client";

import { Clock, HardDrive, Link2Off, LogOut, Unplug, UserRound, UserX, WifiOff, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { STATE_COPY, type StateKind } from "@/lib/auth/copy";
import { LOCAL_PROFILE, openProfile, PROFILE_NOT_SAVED } from "@/lib/auth/profile-switch";
import { Button, buttonClass } from "../ui";
import { AuthShell } from "./shell";

const ICONS: Record<StateKind, LucideIcon> = {
  "accounts-off": HardDrive,
  unavailable: Unplug,
  offline: WifiOff,
  "link-invalid": Link2Off,
  "link-expired": Clock,
  "session-expired": Clock,
  "signed-out": LogOut,
  "not-signed-in": UserRound,
  "account-unavailable": UserX,
};

/**
 * A whole screen for when the form can't be used: accounts are off here, the service or the network is down, a
 * link is bad. It says what happened and what to do next, with the actions as real buttons and links. It never
 * moves the student anywhere on its own; in particular it never drops them into Local Mode.
 */
export function StateScreen({ kind, children, actions }: { kind: StateKind; children?: ReactNode; actions?: ReactNode }) {
  const Icon = ICONS[kind];
  const copy = STATE_COPY[kind];
  return (
    <AuthShell icon={<Icon size={18} />} title={copy.title} lead={<p className="max-w-md">{copy.body}</p>}>
      {children}
      {actions && <div className="flex flex-wrap gap-2.5">{actions}</div>}
    </AuthShell>
  );
}

/** Every action on the account screens is the same height as the forms' main button (40px), so screens match. */
export const ACTION = "h-10 px-4 text-[15px]";

/** The usual actions, so every state screen offers the same words for the same thing. */
export function RetryButton({ onClick, label = "Try again" }: { onClick: () => void; label?: string }) {
  return (
    <Button className={ACTION} onClick={onClick}>
      {label}
    </Button>
  );
}

/**
 * Opens Local Mode. A button, not a link to "/": "/" opens whichever profile this browser last used, which could
 * be an account. This makes the choice explicit, and only when pressed.
 */
export function UseLocalModeButton({ label = "Use Local Mode", primary = false }: { label?: string; primary?: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <>
      <Button
        variant={primary ? "primary" : "secondary"}
        className={ACTION}
        onClick={() => setFailed(!openProfile(LOCAL_PROFILE, { storage: safeLocalStorage(), go: (u) => window.location.assign(u) }))}
      >
        {label}
      </Button>
      {failed && (
        <p role="alert" className="basis-full text-[13px] font-medium text-bad">
          {PROFILE_NOT_SAVED}
        </p>
      )}
    </>
  );
}

export function SignInLink({ label = "Sign in", primary = true, href = "/login" }: { label?: string; primary?: boolean; href?: string }) {
  return (
    <Link href={href} className={buttonClass(primary ? "primary" : "secondary", "md", ACTION)}>
      {label}
    </Link>
  );
}

export function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
