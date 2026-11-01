import type { AuthErrorCode, SignedOutReason } from "./client";

// Every sentence the account screens show, in one place so the wording stays consistent and can be checked:
// accounts are sign-in only in this release. Nothing here may claim backup, sync or cloud storage (a test enforces it).

/** What an account is, right now. Shown on sign-up, on /switch and wherever someone is about to open account data. */
export const ACCOUNT_FACTS = [
  { title: "Sign-in only, for now", body: "An account keeps your data separate from Local Mode on this device. There's no backup or sync yet." },
  { title: "Your data stays on this device", body: "Whatever you add while signed in is stored in this browser, apart from your Local Mode data." },
  { title: "Nothing is copied or uploaded", body: "Signing in or switching never moves or merges your Local Mode data into the account. You can switch back to it any time." },
] as const;

/** One line under the sign-in form, for people who don't need an account. */
export const LOCAL_MODE_LINE = "No account needed: Local Mode keeps everything in this browser.";

/** A problem with a request, as the student should read it. `retryAfter` is in seconds. */
export function errorMessage(code: AuthErrorCode, retryAfter?: number): string {
  switch (code) {
    case "invalid_credentials":
      return "That email and password don't match an account. Check both and try again.";
    case "email_not_confirmed":
      return "Confirm your email address first. We can send the link again.";
    case "weak_password":
      return "That password can't be used. Choose a different one, at least 10 characters long.";
    case "same_password":
      return "That's your current password. Choose a new one.";
    case "invalid_input":
      return "Something in the form isn't right. Check the highlighted fields.";
    case "link_invalid":
      return "This link isn't valid. It may have been copied incompletely.";
    case "link_expired":
      return "This link has expired or was already used. Ask for a new one.";
    case "session_missing":
      return "Your sign-in has ended. Sign in again to continue.";
    case "user_mismatch":
      return "You're signed in as a different account in another tab. Reload this page to continue.";
    case "rate_limited":
      return retryAfter ? `Too many attempts. Try again in ${formatWait(retryAfter)}.` : "Too many attempts. Wait a few minutes and try again.";
    case "unavailable":
      return "The sign-in service isn't answering right now. Your data on this device is safe; try again in a minute.";
    case "disabled":
    case "not_available":
      return "Accounts aren't available on this copy of Amity Exams. Local Mode works as usual.";
    case "blocked":
      return "This request was blocked. Reload the page and try again.";
    case "offline":
      return "You're offline. Connect to the internet to sign in; Local Mode keeps working without it.";
    case "network":
      return "Couldn't reach the server. Check your connection and try again.";
    default:
      return "Something went wrong. Try again in a moment.";
  }
}

export function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const m = Math.ceil(seconds / 60);
  return `${m} minute${m === 1 ? "" : "s"}`;
}

/** Why someone was sent to sign in, as a notice above the form (?reason= on /login). */
export const SIGNED_OUT_NOTICE: Record<Exclude<SignedOutReason, "none"> | "signed-out" | "verify", { title: string; body: string }> = {
  "signed-out": { title: "You're signed out", body: "Sign in to open your account's data on this device." },
  expired: { title: "Your session expired", body: "Sign in again to open your account's data. Nothing on this device was changed." },
  revoked: {
    title: "You were signed out",
    body: "Your password changed or you signed out on another device. Sign in again to continue.",
  },
  deleted: { title: "That account no longer exists", body: "Its data on this device stays closed. Sign in with another account or use Local Mode." },
  banned: { title: "That account can't sign in", body: "Its data on this device stays closed. Use another account or Local Mode." },
  verify: { title: "Confirm your email first", body: "Open the link we sent you, then sign in here." },
};
export type NoticeReason = keyof typeof SIGNED_OUT_NOTICE;
export const isNoticeReason = (v: string | null): v is NoticeReason => !!v && v in SIGNED_OUT_NOTICE;

/** Full-screen states for when the form itself can't be used. */
export type StateKind = "accounts-off" | "unavailable" | "offline" | "link-invalid" | "link-expired" | "session-expired" | "signed-out" | "not-signed-in" | "account-unavailable";

export const STATE_COPY: Record<StateKind, { title: string; body: string }> = {
  "accounts-off": {
    title: "Accounts aren't available here",
    body: "This copy of Amity Exams runs in Local Mode only. Everything you add stays in this browser.",
  },
  unavailable: {
    title: "Sign-in isn't answering",
    body: "The sign-in service couldn't be reached just now. Nothing on this device was changed. Try again in a minute.",
  },
  offline: {
    title: "You're offline",
    body: "Signing in needs a connection. Local Mode keeps working offline, with everything already in this browser.",
  },
  "link-invalid": {
    title: "This link doesn't work",
    body: "It may have been cut short when it was copied, or this page was reloaded after the link was read. Open it straight from the email again, or ask for a new one.",
  },
  "link-expired": {
    title: "This link has expired",
    body: "Links work once and only for a limited time. Ask for a new one and use the newest email.",
  },
  "session-expired": {
    title: "Your session expired",
    body: "Sign in again to open your account's data. Nothing on this device was changed.",
  },
  "signed-out": {
    title: "You're signed out",
    body: "Your account's data on this device stays closed until you sign in again.",
  },
  "not-signed-in": {
    title: "No account is signed in",
    body: "Sign in to open an account's data on this device, or keep using Local Mode.",
  },
  "account-unavailable": {
    title: "This account isn't available",
    body: "It may have been deleted or blocked. Its data on this device stays closed.",
  },
};

/**
 * The full screen for "nobody is signed in", given why (the server's reason) and whether this browser was last
 * using an account. Someone who never signed in isn't told they were signed out.
 */
export function signedOutState(reason: SignedOutReason, lastUsedAccount: boolean): StateKind {
  if (reason === "deleted" || reason === "banned") return "account-unavailable";
  if (reason === "expired") return "session-expired";
  if (reason === "revoked") return "signed-out";
  return lastUsedAccount ? "signed-out" : "not-signed-in";
}

/** The notice above the sign-in form: the URL's ?reason= if given, otherwise the server's own reason. */
export function signInNotice(urlReason: string | null, serverReason: SignedOutReason | null): NoticeReason | null {
  if (isNoticeReason(urlReason)) return urlReason;
  return serverReason && serverReason !== "none" ? serverReason : null;
}
