// Test-only: drives the /auth/* route handlers with real NextRequests, the REAL @supabase/ssr and auth-js, a fake
// Supabase server (fake-supabase.ts) and a recording rate-limit store. Each test file must also mock the project list
// (vi.mock is hoisted per file):
//   vi.mock("@/lib/supabase/projects", () => ({ SUPABASE_PROJECTS: { development: ["devrefaaaaaaaaaaaaaa"], production: [], local: [] } }));
import { combineChunks, stringFromBase64URL } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { vi } from "vitest";
import { timing } from "@/lib/auth/route";
import { setStoreForTests, type Bucket } from "@/lib/ratelimit";
import { resetAccountsConfigForTests } from "@/lib/supabase/env";
import { COOKIE, cookieHeader, fakeSupabase } from "./fake-supabase";

export const ACCOUNTS = {
  SUPABASE_URL: "https://devrefaaaaaaaaaaaaaa.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_ENV: "development",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAAtest",
};
const CLEARED = ["VERCEL", "VERCEL_ENV", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "RATE_LIMIT_SECRET", "APP_PASSWORD", ...Object.keys(ACCOUNTS)];

export const HOST = "127.0.0.1:3000";
export const ORIGIN = `http://${HOST}`;
export const SAME_ORIGIN = { "sec-fetch-site": "same-origin", origin: ORIGIN };

/** A rate-limit store that records every check and refuses the buckets in `refuse`. */
export function recordingStore() {
  const checks: { bucket: Bucket; key: string }[] = [];
  const refuse = new Set<Bucket>();
  return {
    checks,
    refuse,
    limit: async (bucket: Bucket, key: string) => {
      checks.push({ bucket, key });
      return { success: !refuse.has(bucket), reset: Date.now() + 90_000 };
    },
  };
}

export type Harness = ReturnType<typeof setupAccounts>;

/** Accounts on (an approved development project), a fresh fake Supabase, a recording store. Call in beforeEach. */
export function setupAccounts({ enabled = true } = {}) {
  for (const k of CLEARED) vi.stubEnv(k, "");
  if (enabled) for (const [k, v] of Object.entries(ACCOUNTS)) vi.stubEnv(k, v);
  resetAccountsConfigForTests();
  const server = fakeSupabase();
  vi.stubGlobal("fetch", server.fetch);
  const store = recordingStore();
  setStoreForTests(store);
  timing.privacyFloorMs = 0;
  return { server, store };
}

export function teardownAccounts() {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetAccountsConfigForTests();
  setStoreForTests(undefined);
  timing.privacyFloorMs = 1500;
}

type Cookies = { name: string; value: string }[];

/** A same-origin JSON POST, as the app's own pages send it. */
export function post(path: string, body: unknown, { cookies = [] as Cookies, headers = {} as Record<string, string>, raw }: { cookies?: Cookies; headers?: Record<string, string>; raw?: string } = {}) {
  const h: Record<string, string> = { host: HOST, ...SAME_ORIGIN, "content-type": "application/json", ...headers };
  if (cookies.length) h.cookie = cookieHeader(cookies);
  return new NextRequest(`${ORIGIN}${path}`, { method: "POST", headers: h, body: raw ?? JSON.stringify(body) });
}

export function get(path: string, { cookies = [] as Cookies, headers = {} as Record<string, string> } = {}) {
  const h: Record<string, string> = { host: HOST, ...SAME_ORIGIN, ...headers };
  if (cookies.length) h.cookie = cookieHeader(cookies);
  return new NextRequest(`${ORIGIN}${path}`, { method: "GET", headers: h });
}

/** Set-Cookie lines by cookie name. */
export function setCookies(res: Response): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of res.headers.getSetCookie()) out.set(line.split("=")[0], line);
  return out;
}
export const isDeletion = (line: string | undefined) => !!line && /^[^=]+=;/.test(line) && /Max-Age=0/i.test(line);

/** The session the response's cookies hold (as @supabase/ssr would read it back), or null. */
export async function sessionIn(res: Response): Promise<{ refresh_token: string; access_token: string; user?: { id: string } } | null> {
  const values = new Map<string, string>();
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const i = pair.indexOf("=");
    const value = decodeURIComponent(pair.slice(i + 1));
    if (value) values.set(pair.slice(0, i), value);
  }
  const raw = await combineChunks(COOKIE, (name) => values.get(name));
  if (!raw) return null;
  return JSON.parse(raw.startsWith("base64-") ? stringFromBase64URL(raw.slice(7)) : raw);
}
