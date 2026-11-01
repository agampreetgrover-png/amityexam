import { LOCAL, parseProfile, PROFILE_KEY, serializeProfile, type Profile } from "@/lib/profile";

// What /switch shows and does. The decision of WHO is signed in is the server's (GET /auth/session); this only
// compares that answer with the profile this browser last opened, and never switches without a click.
// It doesn't touch any database: the profile gate opens the chosen one after the reload, with its own checks.

export type CurrentProfile = { kind: "local" } | { kind: "user"; userId: string } | { kind: "unknown" };

/** The profile this browser last opened. "unknown" when storage is blocked or holds something unrecognised. */
export function readCurrentProfile(storage: Pick<Storage, "getItem"> | null): CurrentProfile {
  // No storage at all (blocked) is not "Local Mode": nothing can be said about what this browser last opened.
  if (!storage) return { kind: "unknown" };
  let raw: string | null;
  try {
    raw = storage.getItem(PROFILE_KEY);
  } catch {
    return { kind: "unknown" };
  }
  const p = parseProfile(raw);
  return p === "invalid" ? { kind: "unknown" } : p;
}

export type SwitchPlan =
  /** The verified account is already the open profile: nothing to confirm. */
  | { kind: "already-open"; userId: string }
  /** A different profile is open (Local Mode, another account, or unknown): ask before switching. */
  | { kind: "confirm"; from: CurrentProfile; to: { userId: string; email: string | null } }
  /** Nobody verified: there is nothing to switch to. Never falls back to Local Mode on its own. */
  | { kind: "no-account" };

export function planSwitch(current: CurrentProfile, verified: { id: string; email: string | null } | null): SwitchPlan {
  if (!verified) return { kind: "no-account" };
  if (current.kind === "user" && current.userId === verified.id.toLowerCase()) return { kind: "already-open", userId: current.userId };
  return { kind: "confirm", from: current, to: { userId: verified.id, email: verified.email } };
}

/**
 * Remember the chosen profile and load the app fresh, so no open database or live query carries over.
 * Only ever called from a button the student pressed. Returns false, and goes nowhere, when the choice couldn't be
 * saved (storage blocked or full): loading the app then would open whatever was stored before, possibly Local Mode,
 * which is exactly the silent fallback that must not happen. The caller shows an error instead.
 */
export function openProfile(target: Profile, deps: { storage: Pick<Storage, "setItem" | "getItem"> | null; go: (url: string) => void }, to = "/"): boolean {
  const want = serializeProfile(target);
  try {
    deps.storage?.setItem(PROFILE_KEY, want);
    if (!deps.storage || deps.storage.getItem(PROFILE_KEY) !== want) return false;
  } catch {
    return false;
  }
  deps.go(to);
  return true;
}

/** Shown when openProfile returns false. */
export const PROFILE_NOT_SAVED = "This browser didn't let Amity Exams save which data to open (site storage is blocked or full), so nothing was switched. Allow site data for this site and try again.";

export const LOCAL_PROFILE = LOCAL;
