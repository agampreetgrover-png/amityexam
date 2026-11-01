// The address a confirmation email was just sent to, carried from sign-up (or a sign-in that needs confirming) to
// /check-email for this tab only. It is an email address, never a password or a token, and it is kept out of the
// URL so it doesn't land in browser history or server logs. Losing it is fine: /check-email then asks for it.

const KEY = "amityexams:pending-email";

export function rememberPendingEmail(email: string, storage: Pick<Storage, "setItem"> | null = session()) {
  try {
    storage?.setItem(KEY, email);
  } catch {}
}

export function readPendingEmail(storage: Pick<Storage, "getItem"> | null = session()): string | null {
  try {
    const v = storage?.getItem(KEY) ?? null;
    return v && v.length <= 254 ? v : null;
  } catch {
    return null;
  }
}

export function forgetPendingEmail(storage: Pick<Storage, "removeItem"> | null = session()) {
  try {
    storage?.removeItem(KEY);
  } catch {}
}

function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
