// Test-only (never imported by the app): a fake Supabase Auth server reached through a stubbed fetch, so tests run
// the REAL @supabase/ssr and @supabase/auth-js code (cookie chunking, retries, error mapping) instead of a mock of
// them. Every reply is scripted per endpoint; "hang" never answers until the request is aborted.
import { createServerClient } from "@supabase/ssr";

export type Reply = { status: number; body?: unknown } | "hang";
type Endpoint = "refresh" | "password" | "user" | "other";

export const SUPABASE_URL = "https://devref.supabase.co";
export const COOKIE = "sb-devref-auth-token";
const USER_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** A structurally valid access token (not signed: nothing here verifies it). */
const accessToken = (expiresAt: number) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER_ID, aud: "authenticated", role: "authenticated", exp: expiresAt, session_id: "s1" })}.sig`;

let counter = 0;
/** What Supabase answers to a successful sign-in or refresh. A big `bio` makes the cookie split into chunks. */
export function sessionBody(expiresInS: number, bio = "") {
  const expires_at = Math.floor(Date.now() / 1000) + expiresInS;
  return {
    access_token: accessToken(expires_at),
    refresh_token: `rt-${++counter}`,
    token_type: "bearer",
    expires_in: expiresInS,
    expires_at,
    user: { id: USER_ID, aud: "authenticated", role: "authenticated", email: "a@example.test", email_confirmed_at: "2026-11-01T00:00:00Z", user_metadata: bio ? { bio } : {}, app_metadata: {} },
  };
}

export function fakeSupabase() {
  const calls: { at: number; endpoint: Endpoint }[] = [];
  const queues: Partial<Record<Endpoint, Reply[]>> = {};
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    const endpoint: Endpoint = url.includes("grant_type=refresh_token") ? "refresh" : url.includes("grant_type=password") ? "password" : url.includes("/auth/v1/user") ? "user" : "other";
    calls.push({ at: Date.now(), endpoint });
    const reply = queues[endpoint]?.shift() ?? { status: 404, body: { code: "not_found", msg: "no reply scripted" } };
    if (reply === "hang") {
      return new Promise((_, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) return reject(signal.reason);
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
    // Real Supabase Auth sends its API version; without it auth-js ignores the "code" in error bodies.
    const headers = { "Content-Type": "application/json", "X-Supabase-Api-Version": "2024-01-01" };
    return Promise.resolve(new Response(JSON.stringify(reply.body ?? {}), { status: reply.status, headers }));
  };
  return {
    fetch: fetchImpl as typeof fetch,
    calls,
    /** Script the next replies for an endpoint, in order. */
    reply(endpoint: Endpoint, ...replies: Reply[]) {
      (queues[endpoint] ??= []).push(...replies);
    },
  };
}

/** The session cookies the real @supabase/ssr writes after signing in, for a session expiring in `expiresInS`. */
export async function signedInCookies(expiresInS: number, bio = ""): Promise<{ name: string; value: string }[]> {
  const server = fakeSupabase();
  server.reply("password", { status: 200, body: sessionBody(expiresInS, bio) });
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
