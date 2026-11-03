import "server-only";
import type { CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { readLimited } from "@/lib/read-limited";
import { checkLimits, emailKey, type Bucket } from "@/lib/ratelimit";
import { accountsConfig, type AccountsConfig } from "@/lib/supabase/env";
import { sessionCookieName } from "@/lib/supabase/middleware";
import { buildServerClient, secureCookieOptions, type CookieJar } from "@/lib/supabase/server";
import { emailError, normalizeEmail } from "./validate";
import { authRequestRefusal } from "./request-guard";
import { MAX_CAPTCHA_TOKEN_CHARS, requestHostname, verifyCaptcha, type CaptchaAction } from "./captcha";

// What every /auth/* route handler shares (the contract they answer is in src/lib/auth/client.ts):
//   - authRequestRefusal first (same-origin + JSON), then "accounts off" → disabled, then a size-limited JSON body;
//   - one deadline for the whole request, shared by every Supabase call (server.ts timedFetch);
//   - answers in the client's shape, never cached;
//   - cookies written only through CookieWrites, which keeps Supabase's own batches apart (see there).

export type EnabledConfig = Extract<AccountsConfig, { enabled: true }>;

/** Every Supabase call of one request together, retries included (the browser gives up after 12s). */
export const ROUTE_DEADLINE_MS = 8000;
/** Auth bodies are tiny: an email, a password, a captcha token. */
export const MAX_BODY_BYTES = 8 * 1024;

export type Field = "email" | "password";

/** JSON, never cached. */
export const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

/** An error in the client's shape; a 429 also carries Retry-After. */
export function failure(status: number, code: string, { retryAfter, field }: { retryAfter?: number; field?: Field } = {}) {
  const error = { code, ...(retryAfter ? { retryAfter } : {}), ...(field ? { field } : {}) };
  return reply({ error }, status, retryAfter ? { "Retry-After": String(retryAfter) } : {});
}
export const unavailable = () => failure(503, "unavailable");
export const disabled = () => failure(404, "disabled");

/** Thrown to end a request with an answer already decided (a refusal, a limit, bad input). */
class Refusal extends Error {
  constructor(readonly response: NextResponse) {
    super("refused");
  }
}
export const refuse = (response: NextResponse): never => {
  throw new Refusal(response);
};

export interface AuthContext {
  req: NextRequest;
  config: EnabledConfig;
  https: boolean;
  deadline: AbortSignal;
  /** The session cookie's name for this project (sb-<ref>-auth-token; chunks add .0, .1…). */
  cookieKey: string;
  /**
   * The cookie writes of the client that holds this request's session (sessionClient / a sign-in's freshClient).
   * Kept here so that even an unexpected error still writes back a session Supabase has already rotated.
   */
  writes: CookieWrites;
}

const isHttps = (req: NextRequest) => req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";

export function contextFor(req: NextRequest, config: EnabledConfig): AuthContext {
  return { req, config, https: isHttps(req), deadline: AbortSignal.timeout(ROUTE_DEADLINE_MS), cookieKey: sessionCookieName(config.url), writes: new CookieWrites() };
}

/** A cookie that holds (part of) this project's session, or its PKCE verifier. */
export const isSessionCookie = (name: string, key: string) =>
  name === key || name === `${key}-code-verifier` || (name.startsWith(`${key}.`) && /^\d+$/.test(name.slice(key.length + 1)));

/**
 * POST /auth/* handler: refuses cross-site and non-JSON requests (authRequestRefusal, again after the middleware),
 * answers "disabled" while accounts are off, reads the body, and turns anything unexpected into "unavailable" (no
 * cookie removed; a session already rotated is still written back). The handler gets the body as a plain object.
 */
export function authPost(handler: (ctx: AuthContext, body: Record<string, unknown>) => Promise<NextResponse>) {
  return async (req: NextRequest): Promise<Response> => {
    const refusal = authRequestRefusal(req);
    if (refusal) return refusal;
    const config = accountsConfig();
    if (!config.enabled) return disabled();
    const ctx = contextFor(req, config);
    try {
      const body = await readBody(req);
      return await handler(ctx, body);
    } catch (e) {
      if (e instanceof Refusal) return e.response;
      console.error("[accounts] auth route failed:", e instanceof Error ? e.name : "unknown");
      return ctx.writes.saves(unavailable());
    }
  };
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) refuse(failure(413, "invalid_input"));
  const bytes = await readLimited(req.body, MAX_BODY_BYTES);
  if (!bytes) refuse(failure(413, "invalid_input"));
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes!));
  } catch {
    refuse(failure(400, "invalid_input"));
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse(failure(400, "invalid_input"));
  return value as Record<string, unknown>;
}

// ── Input ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The email, trimmed and checked the same way the form checks it; otherwise invalid_input on the email field. */
export function emailFrom(body: Record<string, unknown>): string {
  const raw = body.email;
  if (typeof raw !== "string" || emailError(raw)) refuse(failure(400, "invalid_input", { field: "email" }));
  return normalizeEmail(raw as string);
}

/**
 * The CAPTCHA token every sign-in, sign-up and email request must carry (H1). Missing or malformed → captcha_failed,
 * before anything is counted or asked. It is checked by requireCaptcha, never passed on to Supabase.
 */
export function captchaFrom(body: Record<string, unknown>): string {
  const t = body.captchaToken;
  if (typeof t !== "string" || !t || t.length > MAX_CAPTCHA_TOKEN_CHARS) refuse(failure(400, "captcha_failed"));
  return t as string;
}

/**
 * Cloudflare must vouch for the token, for this form's action and this site (src/lib/auth/captcha.ts). Refused with
 * 403 captcha_failed otherwise; 503 when Cloudflare can't be asked (fail closed). Called after the per-IP limits (so a
 * flood without CAPTCHAs is turned away cheaply) and before the global ones (so only solved CAPTCHAs can use those).
 */
export async function requireCaptcha(ctx: AuthContext, token: string, action: CaptchaAction): Promise<void> {
  const result = await verifyCaptcha({
    secret: ctx.config.turnstileSecretKey,
    token,
    action,
    hostname: requestHostname(ctx.req.headers.get("host") ?? ""),
    deadline: ctx.deadline,
  });
  if (result === "ok") return;
  if (result === "failed") refuse(failure(403, "captcha_failed"));
  refuse(unavailable());
}

// ── Rate limits ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Refuses with 429 (Retry-After) when a bucket is over its limit, or 503 when the store can't answer (fail closed). */
export async function enforceLimits(checks: { bucket: Bucket; key: string }[]): Promise<void> {
  const r = await checkLimits(checks);
  if (r.ok) return;
  if (r.reason === "limited") refuse(failure(429, "rate_limited", { retryAfter: r.retryAfter }));
  refuse(unavailable());
}

/** The email's bucket key (an HMAC, never the address), or 503 when it can't be computed safely (fail closed). */
export function emailBucket(ctx: AuthContext, email: string): string {
  const key = emailKey(email, ctx.config.rateLimitSecret);
  if (!key) refuse(unavailable());
  return key!;
}

// ── Cookies ──────────────────────────────────────────────────────────────────────────────────────────────────────

type CookieWrite = { name: string; value: string; options: CookieOptions };

/**
 * Supabase's cookie writes for one request, kept in the batches @supabase/ssr hands them over in. Each batch is one
 * change to the stored session: a SAVE (a new or rotated session, with the deletion of chunks it no longer needs) or
 * a REMOVAL (deletions only). The two are applied by different rules:
 *   - all(): when the outcome is known (signed in, or definitely signed out);
 *   - saves(): when it isn't ("unavailable"). A rotated session must still reach the browser, or it keeps a refresh
 *     token Supabase has already used and is signed out at the next refresh; a removal must not, since nothing
 *     says the session is gone.
 */
export class CookieWrites {
  private batches: CookieWrite[][] = [];
  private extra: CookieWrite[] = [];
  private headers: Record<string, string> = {};

  /** A jar for buildServerClient that reads `source` and records every write. */
  jar(source: { name: string; value: string }[]): CookieJar {
    return {
      getAll: () => source,
      set: (name, value, options) => this.batches.push([{ name, value, options }]), // unused: setBatch is preferred
      setBatch: (cookies) => this.batches.push(cookies.map((c) => ({ ...c }))),
      setHeaders: (h) => Object.assign(this.headers, h),
    };
  }

  /** Explicitly delete every session cookie the request carried (signed out for good, or signing out). */
  deleteSession(ctx: AuthContext) {
    for (const c of ctx.req.cookies.getAll()) {
      if (isSessionCookie(c.name, ctx.cookieKey)) this.extra.push({ name: c.name, value: "", options: secureCookieOptions({ maxAge: 0 }, ctx.https) });
    }
  }

  /**
   * After a sign-in by a client that started without the request's cookies: delete the request's session cookies
   * the new session didn't overwrite (a longer old session leaves chunks .1, .2… that would corrupt the new one).
   */
  replaceSession(ctx: AuthContext) {
    const written = new Set(this.batches.flat().map((w) => w.name));
    for (const c of ctx.req.cookies.getAll()) {
      if (isSessionCookie(c.name, ctx.cookieKey) && !written.has(c.name)) this.extra.push({ name: c.name, value: "", options: secureCookieOptions({ maxAge: 0 }, ctx.https) });
    }
  }

  /** Set a cookie of our own (the recovery marker), with options chosen by the caller. */
  setCookie(name: string, value: string, options: CookieOptions) {
    this.extra.push({ name, value, options });
  }

  private isSave = (b: CookieWrite[]) => b.some((w) => w.value !== "");

  /**
   * Signed out for good: delete every session cookie, both those the request carried and any a batch wrote during
   * this request (a refresh that succeeded before Supabase said "gone" may have written new chunk names), and write
   * no session at all.
   */
  signedOut(ctx: AuthContext, res: NextResponse) {
    const names = new Set(ctx.req.cookies.getAll().map((c) => c.name));
    for (const w of this.batches.flat()) names.add(w.name);
    const gone = secureCookieOptions({ maxAge: 0 }, ctx.https);
    const deletions = [...names].filter((n) => isSessionCookie(n, ctx.cookieKey)).map((name) => ({ name, value: "", options: gone }));
    return this.write(res, [...deletions, ...this.extra.filter((w) => !isSessionCookie(w.name, ctx.cookieKey))]);
  }

  /** Every batch plus the explicit deletions. */
  all(res: NextResponse) {
    return this.write(res, [...this.batches.flat(), ...this.extra]);
  }
  /** Only batches that save a session (see the class comment). */
  saves(res: NextResponse) {
    return this.write(res, this.batches.filter(this.isSave).flat());
  }
  /** Only the explicit deletions (sign-out ignores whatever Supabase's client wrote). */
  deletionsOnly(res: NextResponse) {
    return this.write(res, this.extra);
  }

  private write(res: NextResponse, writes: CookieWrite[]) {
    // The last write of a name wins (a batch may set a chunk an earlier one deleted).
    const last = new Map<string, CookieWrite>();
    for (const w of writes) last.set(w.name, w);
    for (const w of last.values()) res.cookies.set(w.name, w.value, w.options);
    if (last.size) for (const [k, v] of Object.entries(this.headers)) res.headers.set(k, v);
    res.headers.set("Cache-Control", "no-store");
    return res;
  }
}

/** A client that sees the request's session cookies: for checking, changing or ending the session the browser holds. */
export function sessionClient(ctx: AuthContext, writes: CookieWrites): SupabaseClient {
  return buildServerClient(ctx.config.url, ctx.config.publishableKey, writes.jar(ctx.req.cookies.getAll()), { https: ctx.https, deadline: ctx.deadline });
}

/**
 * A client that starts with NO cookies at all: for signing in, signing up, sending emails and verifying links.
 * A client given the request's cookies refreshes a stale session in them alongside the sign-in (observed with auth-js
 * 2.118: see the CONTROL test in src/app/auth/signin-routes.test.ts). That spends this server's shared /token budget,
 * and its late answer lands in the call log after the sign-in, where it would be read as evidence about the NEW
 * session. Starting empty, there is nothing to refresh; the old cookies are replaced on success (replaceSession).
 */
export function freshClient(ctx: AuthContext, writes: CookieWrites): SupabaseClient {
  return buildServerClient(ctx.config.url, ctx.config.publishableKey, writes.jar([]), { https: ctx.https, deadline: ctx.deadline });
}

// ── Supabase errors ──────────────────────────────────────────────────────────────────────────────────────────────

export type SupabaseError = { code?: unknown; status?: unknown; name?: unknown } | null | undefined;
export const codeOf = (e: SupabaseError) => (typeof e?.code === "string" ? e.code : undefined);
export const statusOf = (e: SupabaseError) => (typeof e?.status === "number" ? e.status : 0);
/** Supabase (or its client) said too many requests: a 429 or one of its over_*_limit codes. */
export const isRateLimited = (e: SupabaseError) => statusOf(e) === 429 || /^over_.*limit$/.test(codeOf(e) ?? "");

// ── Timing ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Sign-up, resend and forgot answer no sooner than this after the request arrived, whatever happened: Supabase
 * sends an email for some addresses and not others, and the time that takes must not say which. Tests lower it.
 */
export const timing = { privacyFloorMs: 1500 };

export async function noSoonerThan(started: number): Promise<void> {
  const wait = started + timing.privacyFloorMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
