"use client";

import { DatabaseZap, UserRound } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { openDb, OwnerMismatchError } from "@/lib/db";
import { LOCAL, PROFILE_CHANNEL, readStoredProfile, resolveProfile, switchProfile, type Profile } from "@/lib/profile";
import { Button } from "./ui";

type State =
  | { status: "loading" }
  | { status: "open"; profile: Profile }
  | { status: "needs-signin"; userId: string | null }
  | { status: "error"; message: string };

/**
 * The verified signed-in user, or null. Sign-in doesn't exist yet (Phase 2b adds Supabase), so no cloud profile can
 * be confirmed and only Local Mode opens.
 */
async function sessionUserId(): Promise<string | null> {
  return null;
}

/** Signals other tabs that a cloud account signed out on this device (used from Phase 2b). */
export type ProfileMessage = { type: "signed-out"; userId: string };

/**
 * Opens the browser database for this page load, then renders the app. Nothing below it mounts (and no live query
 * runs) until the right database is open, and the database is chosen here, in the browser, never at import time.
 */
export function ProfileGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = resolveProfile(readStoredProfile(), await sessionUserId());
      if (r.status === "needs-signin") return !cancelled && setState(r);
      try {
        await openDb(r.profile);
        if (!cancelled) setState({ status: "open", profile: r.profile });
      } catch (e) {
        const message =
          e instanceof OwnerMismatchError
            ? "The saved data in this browser doesn't belong to the selected profile, so it wasn't opened. Nothing was changed."
            : `Couldn't open this browser's storage (${e instanceof Error ? e.message : "unknown error"}). Private windows and blocked site data can cause this.`;
        if (!cancelled) setState({ status: "error", message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Another tab signed this account out: reload so this tab stops using its database.
  useEffect(() => {
    if (state.status !== "open" || state.profile.kind !== "user" || typeof BroadcastChannel === "undefined") return;
    const userId = state.profile.userId;
    const channel = new BroadcastChannel(PROFILE_CHANNEL);
    channel.onmessage = (ev: MessageEvent<ProfileMessage>) => {
      if (ev.data?.type === "signed-out" && ev.data.userId === userId) window.location.reload();
    };
    return () => channel.close();
  }, [state]);

  if (state.status === "loading") return null;
  if (state.status === "open") return <>{children}</>;
  if (state.status === "needs-signin") {
    return (
      <GateScreen icon={<UserRound size={18} />} title="Sign in to open your account's data">
        <p>
          This device was last used with a cloud account. Its data stays closed until that account signs in again. Your
          Local Mode data on this device is separate and unaffected.
        </p>
        <Button className="mt-5" onClick={() => switchProfile(LOCAL)}>
          Use Local Mode
        </Button>
      </GateScreen>
    );
  }
  return (
    <GateScreen icon={<DatabaseZap size={18} />} title="Your data couldn't be opened">
      <p>{state.message}</p>
      <Button className="mt-5" variant="secondary" onClick={() => window.location.reload()}>
        Try again
      </Button>
    </GateScreen>
  );
}

function GateScreen({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col justify-center bg-bg px-4 py-12">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent">{icon}</div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{title}</h1>
        <div className="mt-2 text-[15px] leading-relaxed text-muted">{children}</div>
      </div>
    </main>
  );
}
