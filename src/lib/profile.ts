// Which browser database this page load uses. Local Mode keeps the original "amityexams" database; each cloud account
// gets its own, so one account's data can never be read or written while another profile is open.
// Separate databases prevent ACCIDENTAL mixing only: IndexedDB isn't encrypted, and anyone using this browser profile
// can read every one of them.

export type Profile = { kind: "local" } | { kind: "user"; userId: string };

/** localStorage key holding the profile chosen on this device: "local" or "u:<userId>". */
export const PROFILE_KEY = "amityexams:profile";
/** Tells other open tabs to reload, e.g. after this account signs out. */
export const PROFILE_CHANNEL = "amityexams-profile";
export const LOCAL_DB_NAME = "amityexams";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LOCAL: Profile = { kind: "local" };

/** What the database's `owner` marker must say for this profile. */
export const ownerOf = (p: Profile) => (p.kind === "local" ? "local" : p.userId);

export const dbNameOf = (p: Profile) => (p.kind === "local" ? LOCAL_DB_NAME : `${LOCAL_DB_NAME}-u-${p.userId}`);

export const serializeProfile = (p: Profile) => (p.kind === "local" ? "local" : `u:${p.userId}`);

/** The stored value, read back. Nothing stored means Local Mode; anything unrecognised is "invalid", never a guess. */
export function parseProfile(raw: string | null): Profile | "invalid" {
  if (raw === null || raw === "local") return LOCAL;
  if (raw.startsWith("u:") && UUID.test(raw.slice(2))) return { kind: "user", userId: raw.slice(2).toLowerCase() };
  return "invalid";
}

export type Resolution =
  | { status: "open"; profile: Profile }
  /** A cloud profile is stored but no matching signed-in session was found: don't open any database. */
  | { status: "needs-signin"; userId: string | null };

/**
 * Decide which database to open. `sessionUserId` is the verified signed-in user (online: checked with the auth
 * server; offline: the stored session), or null. A cloud database opens only when it belongs to that user.
 */
export function resolveProfile(raw: string | null, sessionUserId: string | null): Resolution {
  const p = parseProfile(raw);
  if (p === "invalid") return { status: "needs-signin", userId: null };
  if (p.kind === "local") return { status: "open", profile: p };
  if (sessionUserId && sessionUserId.toLowerCase() === p.userId) return { status: "open", profile: p };
  return { status: "needs-signin", userId: p.userId };
}

/** The profile stored on this device, read safely (storage can be blocked or throw). Browser only. */
export function readStoredProfile(): string | null {
  try {
    return window.localStorage.getItem(PROFILE_KEY);
  } catch {
    return null;
  }
}

/** Store a profile and reload, so no live query or open database carries over from the previous one. */
export function switchProfile(p: Profile) {
  try {
    window.localStorage.setItem(PROFILE_KEY, serializeProfile(p));
  } catch {
    // Storage blocked: the reload falls back to Local Mode, which is the safe default.
  }
  window.location.reload();
}
