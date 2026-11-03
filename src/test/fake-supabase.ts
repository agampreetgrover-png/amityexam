// Test-only (never imported by the app): a fake Supabase Auth server reached through a stubbed fetch, so tests run
// the REAL @supabase/ssr and @supabase/auth-js code (cookie chunking, retries, error mapping) instead of a mock of
// them. Every reply is scripted per endpoint; "hang" never answers until the request is aborted, "network" fails
// the way fetch does when the network is down, and a reply with `delayMs` arrives that much later (or fails if the
// request is aborted first).
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { createServerClient } from "@supabase/ssr";

export type Reply = { status: number; body?: unknown; delayMs?: number } | "hang" | "network";
export type Endpoint = "refresh" | "password" | "user" | "update-user" | "signup" | "verify" | "recover" | "resend" | "logout" | "other";

/** A development project ref in Supabase's real format (20 lowercase letters or digits). */
export const DEV_REF = "devrefaaaaaaaaaaaaaa";
export const SUPABASE_URL = `https://${DEV_REF}.supabase.co`;
export const COOKIE = `sb-${DEV_REF}-auth-token`;
export const USER_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

// The project's signing key, as a Supabase project with asymmetric JWT signing keys (ES256) has: access tokens are
// really signed with it, and its public half is served at /auth/v1/.well-known/jwks.json (token-proof.ts checks them).
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
export const SIGNING_KID = "test-es256-key";
export const PUBLIC_JWK = { ...(publicKey.export({ format: "jwk" }) as Record<string, unknown>), kid: SIGNING_KID, alg: "ES256", use: "sig" };
/** Another ES256 key, never published: tokens signed with it are forgeries. */
const stranger = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;

const claimsFor = (expiresAt: number, claims: Record<string, unknown>) => ({
  iss: `${SUPABASE_URL}/auth/v1`,
  sub: USER_ID,
  aud: "authenticated",
  role: "authenticated",
  exp: expiresAt,
  session_id: "s1",
  ...claims,
});
const es256 = (key: KeyObject, kid: string, payload: Record<string, unknown>) => {
  const signed = `${b64({ alg: "ES256", typ: "JWT", kid })}.${b64(payload)}`;
  return `${signed}.${sign("sha256", Buffer.from(signed), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
};

/** An access token signed with the project's published key (ES256). `claims` adds or overrides claims (amr…). */
export const accessToken = (expiresAt: number, claims: Record<string, unknown> = {}) => es256(privateKey, SIGNING_KID, claimsFor(expiresAt, claims));
/** A token as an HS256 project signs it: nothing here can check it (the secret is never published). */
export const hs256AccessToken = (expiresAt: number, claims: Record<string, unknown> = {}) =>
  `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claimsFor(expiresAt, claims))}.c2lnbmF0dXJl`;
/** A forgery: names the project's published key id, but is signed with another key. */
export const forgedAccessToken = (expiresAt: number, claims: Record<string, unknown> = {}) => es256(stranger, SIGNING_KID, claimsFor(expiresAt, claims));

let counter = 0;
/** What Supabase answers to a successful sign-in or refresh. A big `bio` makes the cookie split into chunks. */
export function sessionBody(expiresInS: number, bio = "", claims: Record<string, unknown> = {}, userId = USER_ID) {
  const expires_at = Math.floor(Date.now() / 1000) + expiresInS;
  return {
    access_token: accessToken(expires_at, { sub: userId, ...claims }),
    refresh_token: `rt-${++counter}`,
    token_type: "bearer",
    expires_in: expiresInS,
    expires_at,
    user: { id: userId, aud: "authenticated", role: "authenticated", email: "a@example.test", email_confirmed_at: "2026-11-01T00:00:00Z", user_metadata: bio ? { bio } : {}, app_metadata: {} },
  };
}

function endpointOf(url: string, method: string): Endpoint {
  const u = new URL(url);
  const grant = u.searchParams.get("grant_type");
  const path = u.pathname;
  if (path.endsWith("/auth/v1/token")) return grant === "refresh_token" ? "refresh" : grant === "password" ? "password" : grant === "pkce" ? "verify" : "other";
  if (path.endsWith("/auth/v1/user")) return method === "PUT" ? "update-user" : "user";
  if (path.endsWith("/auth/v1/signup")) return "signup";
  if (path.endsWith("/auth/v1/verify")) return "verify";
  if (path.endsWith("/auth/v1/recover")) return "recover";
  if (path.endsWith("/auth/v1/resend")) return "resend";
  if (path.endsWith("/auth/v1/logout")) return "logout";
  return "other";
}

/**
 * The fake Turnstile: a token "captcha:<action>:<hostname>" is one Cloudflare vouches for, made for that form on that
 * host; anything else is a token it refuses. captchaReplies (if any) answer first, in order.
 */
export const captchaToken = (action: string, hostname = "127.0.0.1") => `captcha:${action}:${hostname}`;
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function fakeSupabase() {
  const calls: { at: number; endpoint: Endpoint; url: string; body: unknown; bearer: string | null }[] = [];
  const queues: Partial<Record<Endpoint, Reply[]>> = {};
  /** Kept apart from `calls` (which are calls to Supabase Auth's API): key fetches and CAPTCHA checks. */
  const jwksCalls: { at: number }[] = [];
  const captchaCalls: { token: string | null; secret: string | null }[] = [];
  const captchaReplies: Reply[] = [];
  const state: { jwks: Reply } = { jwks: { status: 200, body: { keys: [PUBLIC_JWK] } } };
  const json = (reply: Exclude<Reply, "hang" | "network">) =>
    new Response(JSON.stringify(reply.body ?? {}), { status: reply.status, headers: { "Content-Type": "application/json" } });
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === SITEVERIFY) {
      const form = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
      const token = form.get("response");
      captchaCalls.push({ token, secret: form.get("secret") });
      const scripted = captchaReplies.shift();
      if (scripted === "network") return Promise.reject(new TypeError("fetch failed"));
      if (scripted === "hang") return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
      if (scripted) return Promise.resolve(json(scripted));
      const m = /^captcha:([a-z]+):(.+)$/.exec(token ?? "");
      return Promise.resolve(
        json(m ? { status: 200, body: { success: true, action: m[1], hostname: m[2], "error-codes": [] } } : { status: 200, body: { success: false, "error-codes": ["invalid-input-response"] } }),
      );
    }
    if (new URL(url).pathname.endsWith("/auth/v1/.well-known/jwks.json")) {
      jwksCalls.push({ at: Date.now() });
      const r = state.jwks;
      if (r === "network") return Promise.reject(new TypeError("fetch failed"));
      if (r === "hang") return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
      return Promise.resolve(json(r));
    }
    const endpoint = endpointOf(url, (init?.method ?? "GET").toUpperCase());
    let body: unknown = undefined;
    try {
      body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    } catch {
      body = init?.body;
    }
    const bearer = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /i, "") ?? null;
    calls.push({ at: Date.now(), endpoint, url, body, bearer });
    const reply = queues[endpoint]?.shift() ?? { status: 404, body: { code: "not_found", msg: "no reply scripted" } };
    if (reply === "network") return Promise.reject(new TypeError("fetch failed"));
    const signal = init?.signal;
    if (reply === "hang") {
      return new Promise((_, reject) => {
        if (signal?.aborted) return reject(signal.reason);
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
    // Real Supabase Auth sends its API version; without it auth-js ignores the "code" in error bodies.
    const headers = { "Content-Type": "application/json", "X-Supabase-Api-Version": "2024-01-01" };
    const respond = () => new Response(JSON.stringify(reply.body ?? {}), { status: reply.status, headers });
    if (!reply.delayMs) return Promise.resolve(respond());
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve(respond()), reply.delayMs);
      signal?.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
    });
  };
  return {
    fetch: fetchImpl as typeof fetch,
    calls,
    jwksCalls,
    captchaCalls,
    /** Script the next replies for an endpoint, in order. */
    reply(endpoint: Endpoint, ...replies: Reply[]) {
      (queues[endpoint] ??= []).push(...replies);
    },
    /** What the key endpoint answers from now on (default: the project's one published ES256 key). */
    setJwks(reply: Reply) {
      state.jwks = reply;
    },
    /** Script the next answers from Cloudflare's siteverify, in order (then back to reading the token). */
    replyCaptcha(...replies: Reply[]) {
      captchaReplies.push(...replies);
    },
  };
}

/** The session cookies the real @supabase/ssr writes after signing in, for a session expiring in `expiresInS`. */
export async function signedInCookies(expiresInS: number, bio = "", claims: Record<string, unknown> = {}): Promise<{ name: string; value: string }[]> {
  const server = fakeSupabase();
  server.reply("password", { status: 200, body: sessionBody(expiresInS, bio, claims) });
  const jar = new Map<string, string>();
  const supabase = createServerClient(SUPABASE_URL, "sb_publishable_test", {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
    global: { fetch: server.fetch },
  });
  const { error } = await supabase.auth.signInWithPassword({ email: "a@example.test", password: "correct horse" });
  if (error) throw error;
  return [...jar].map(([name, value]) => ({ name, value }));
}

export const cookieHeader = (cookies: { name: string; value: string }[]) => cookies.map((c) => `${c.name}=${c.value}`).join("; ");
