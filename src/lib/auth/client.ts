// The browser's side of the same-origin /auth/* endpoints. EXPECTED CONTRACT, not yet implemented by the backend
// (Phase 2b S1 owns the route handlers). Until those routes exist every call resolves to { ok: false, code:
// "not_available" }, and the screens say accounts aren't available here: nothing is faked.
//
// Rules this file keeps (and the tests check):
//   - Only same-origin /auth/* URLs, credentials "same-origin": the session lives in HttpOnly cookies the server sets.
//     This file never reads or writes cookies, localStorage or sessionStorage, and never sees a token.
//   - No Supabase library: the browser never talks to Supabase.
//   - It decides nothing about identity. The server's answer is passed on as it is.
//
// ── Contract ────────────────────────────────────────────────────────────────────────────────────────────────────
// Every POST takes JSON (Content-Type: application/json) and answers JSON with Cache-Control: no-store.
// Every non-GET /auth/* handler must refuse cross-site requests itself (Sec-Fetch-Site / Origin): today's middleware
// only does that for /api/* and POST /unlock. Email links should carry the token in the fragment
// (/auth/confirm#token_hash=…&type=…) so it never reaches the server or its logs.
//   Success: 200 with the body listed per endpoint.
//   Failure: 4xx/5xx with { "error": { "code": AuthErrorCode, "retryAfter"?: seconds, "field"?: "email" | "password" } }.
//            429 also sends Retry-After. Messages shown to the student come from src/lib/auth/copy.ts, keyed by code.
//
//   GET  /auth/session          → SessionInfo (below). Never fails for "signed out": that is a state, not an error.
//   POST /auth/login            { email, password, captchaToken? }            → { userId, email }
//                                 errors: invalid_credentials, email_not_confirmed, rate_limited, unavailable, disabled
//   POST /auth/signup           { email, password, captchaToken? }            → {}   (identical for new and existing emails)
//                                 errors: invalid_input (field), weak_password, rate_limited, unavailable, disabled
//   POST /auth/resend           { email, captchaToken? }                      → {}   (always generic)
//   POST /auth/forgot           { email, captchaToken? }                      → {}   (always generic)
//   POST /auth/verify           { tokenHash, type: "signup"|"email"|"recovery" } → { userId, email, type }
//                                 errors: link_invalid, link_expired, rate_limited, unavailable
//   POST /auth/update-password  { password, expectedUserId }                 → {}
//                                 errors: session_missing, user_mismatch, weak_password, same_password, rate_limited
//                                 Must also sign out the account's other sessions (decision D6); the success screen says so.
//                                 Must only accept a session that came from a recovery link (or a recent sign-in).
//   POST /auth/signout          {}                                            → {}
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type SignedOutReason = "none" | "expired" | "revoked" | "deleted" | "banned";

export type SessionInfo =
  | { state: "disabled" }
  | { state: "verified"; user: { id: string; email: string | null; emailVerified: boolean }; verifiedAt: string }
  | { state: "signed-out"; reason: SignedOutReason }
  | { state: "unavailable" };

/** Codes the backend may send, plus the ones this client produces itself (offline, network, not_available, unknown). */
export type AuthErrorCode =
  | "invalid_input"
  | "invalid_credentials"
  | "email_not_confirmed"
  | "weak_password"
  | "same_password"
  | "link_invalid"
  | "link_expired"
  | "session_missing"
  | "user_mismatch"
  | "rate_limited"
  | "unavailable"
  | "disabled"
  | "blocked"
  | "offline"
  | "network"
  | "not_available"
  | "unknown";

const KNOWN_CODES = new Set<AuthErrorCode>([
  "invalid_input", "invalid_credentials", "email_not_confirmed", "weak_password", "same_password", "link_invalid",
  "link_expired", "session_missing", "user_mismatch", "rate_limited", "unavailable", "disabled", "blocked",
]);

export type AuthFailure = { ok: false; code: AuthErrorCode; retryAfter?: number; field?: "email" | "password" };
export type AuthResult<T> = ({ ok: true } & T) | AuthFailure;

export type VerifyType = "signup" | "email" | "recovery";

const TIMEOUT_MS = 12_000;

type Fetch = typeof fetch;
let fetchImpl: Fetch | null = null;
/** Tests only. */
export function setFetchForTests(f: Fetch | null) {
  fetchImpl = f;
}

/** AbortSignal.timeout, with a fallback for browsers that lack it (iOS Safari before 16). */
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

function retryAfterOf(res: Response, body: unknown): number | undefined {
  const fromBody = (body as { error?: { retryAfter?: unknown } } | null)?.error?.retryAfter;
  if (typeof fromBody === "number" && fromBody > 0) return Math.ceil(fromBody);
  const header = Number(res.headers.get("retry-after"));
  return Number.isFinite(header) && header > 0 ? Math.ceil(header) : undefined;
}

async function readJson(res: Response): Promise<unknown> {
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Turns any answer (or no answer) into a result. Exported for tests. */
export async function toResult<T>(res: Response): Promise<AuthResult<T>> {
  const body = await readJson(res);
  if (res.ok) {
    if (body === null || typeof body !== "object") return { ok: false, code: "not_available" };
    return { ok: true, ...(body as T) };
  }
  const err = (body as { error?: { code?: unknown; field?: unknown } } | null)?.error;
  const sent = typeof err?.code === "string" && KNOWN_CODES.has(err.code as AuthErrorCode) ? (err.code as AuthErrorCode) : null;
  const field = err?.field === "email" || err?.field === "password" ? err.field : undefined;
  const retryAfter = retryAfterOf(res, body);
  const fail = (code: AuthErrorCode): AuthFailure => ({ ok: false, code, ...(retryAfter ? { retryAfter } : {}), ...(field ? { field } : {}) });
  if (sent) return fail(sent);
  if (res.status === 429) return fail("rate_limited");
  if (res.status === 403) return fail("blocked"); // a cross-site refusal, or the APP_PASSWORD lock
  if (res.status >= 500) return fail("unavailable");
  // No JSON error at all: the route doesn't exist yet (Next's 404/405 page).
  if (res.status === 404 || res.status === 405 || body === null) return fail("not_available");
  return fail("unknown");
}

async function call<T>(path: string, init: RequestInit): Promise<AuthResult<T>> {
  if (isOffline()) return { ok: false, code: "offline" };
  try {
    const res = await (fetchImpl ?? fetch)(path, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      signal: timeoutSignal(TIMEOUT_MS),
    });
    return await toResult<T>(res);
  } catch {
    return { ok: false, code: isOffline() ? "offline" : "network" };
  }
}

const post = <T>(path: string, body: object) =>
  call<T>(path, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });

/** Who the server says is signed in. A failure here (offline, not deployed) is reported as such, never as "signed out". */
export async function getSession(): Promise<AuthResult<{ session: SessionInfo }>> {
  const r = await call<SessionInfo>("/auth/session", { method: "GET", headers: { Accept: "application/json" } });
  if (!r.ok) return r;
  const s = r as unknown as SessionInfo;
  if (s.state === "disabled" || s.state === "unavailable") return { ok: true, session: { state: s.state } };
  if (s.state === "signed-out") return { ok: true, session: { state: "signed-out", reason: s.reason ?? "none" } };
  if (s.state === "verified" && s.user && typeof s.user.id === "string") return { ok: true, session: { state: "verified", user: s.user, verifiedAt: s.verifiedAt } };
  return { ok: false, code: "unknown" };
}

type WithCaptcha = { captchaToken?: string };

export const signIn = (v: { email: string; password: string } & WithCaptcha) => post<{ userId: string; email: string }>("/auth/login", v);
export const signUp = (v: { email: string; password: string } & WithCaptcha) => post<object>("/auth/signup", v);
export const resendVerification = (v: { email: string } & WithCaptcha) => post<object>("/auth/resend", v);
export const requestPasswordReset = (v: { email: string } & WithCaptcha) => post<object>("/auth/forgot", v);
export const verifyEmailLink = (v: { tokenHash: string; type: VerifyType }) => post<{ userId: string; email: string; type: VerifyType }>("/auth/verify", v);
export const updatePassword = (v: { password: string; expectedUserId: string }) => post<object>("/auth/update-password", v);
export const signOut = () => post<object>("/auth/signout", {});
