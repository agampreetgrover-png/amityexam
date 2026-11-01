import "server-only";
import { SUPABASE_PROJECTS } from "./projects";

// Whether accounts (Supabase Auth) are switched on for this deployment, and with which project. Accounts are OFF
// unless everything they need is configured AND the Supabase project is the right one for this environment:
//   local (no VERCEL_ENV)  → SUPABASE_ENV must be "development"
//   Vercel Preview         → SUPABASE_ENV must be "development"
//   Vercel Production      → SUPABASE_ENV must be "production"
// Anything missing or mismatched turns accounts off and the app runs as before, with data on this device only.
// The guard catches a missing or mismatched flag; it cannot tell that development credentials were pasted under a
// correct "production" flag, which is why the project ref is logged (never a key) for a person to check.

export type SupabaseEnvName = "development" | "production";

export type AccountsConfig =
  | {
      enabled: true;
      url: string;
      publishableKey: string;
      env: SupabaseEnvName;
      projectRef: string;
      turnstileSiteKey: string;
      /** Shared rate-limit store: required on Vercel, optional elsewhere (local development uses memory). */
      upstash: { url: string; token: string } | null;
      /** Keys rate-limit buckets by email without storing the address. Generated per process when unset locally. */
      rateLimitSecret: string | null;
    }
  | { enabled: false; reason: string };

type Env = Record<string, string | undefined>;

/** "abcd" from https://abcd.supabase.co; the host itself for anything else (e.g. a local Supabase). */
export function projectRefOf(url: string): string {
  const host = new URL(url).hostname;
  return host.endsWith(".supabase.co") ? host.slice(0, -".supabase.co".length) : host;
}

const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/;

/**
 * Why this key can't be used as the publishable key, or null when it can. Only the publishable key
 * (sb_publishable_…) or a legacy anon JWT is allowed: a secret or service-role key would skip the database's row
 * security on the server. The key itself never appears in the message.
 */
export function publishableKeyProblem(key: string, projectRef: string): string | null {
  if (key.startsWith("sb_secret_")) return "SUPABASE_PUBLISHABLE_KEY holds a secret key (sb_secret_…); use the project's publishable key";
  if (key.startsWith("sb_publishable_")) return null;
  const parts = key.split(".");
  if (parts.length === 3) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    } catch {
      return "SUPABASE_PUBLISHABLE_KEY is not a readable key";
    }
    // JSON can be null, a number or a string: none of those is a key's payload.
    if (!parsed || typeof parsed !== "object") return "SUPABASE_PUBLISHABLE_KEY is not a readable key";
    const payload = parsed as { role?: unknown; ref?: unknown };
    if (payload.role === "service_role") return "SUPABASE_PUBLISHABLE_KEY holds the service-role key; use the anon or publishable key";
    if (payload.role !== "anon") return "SUPABASE_PUBLISHABLE_KEY is not an anon key";
    if (typeof payload.ref === "string" && payload.ref !== projectRef) return "SUPABASE_PUBLISHABLE_KEY belongs to a different project than SUPABASE_URL";
    return null;
  }
  return "SUPABASE_PUBLISHABLE_KEY is not a publishable (sb_publishable_…) or anon key";
}

export function readAccountsConfig(env: Env = process.env, projects = SUPABASE_PROJECTS): AccountsConfig {
  const off = (reason: string): AccountsConfig => ({ enabled: false, reason });
  const onVercel = !!env.VERCEL;
  const expected: SupabaseEnvName = env.VERCEL_ENV === "production" ? "production" : "development";

  const url = env.SUPABASE_URL?.trim();
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  const supabaseEnv = env.SUPABASE_ENV?.trim();
  const turnstileSiteKey = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  if (!url || !publishableKey) return off("SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY is not set");
  if (supabaseEnv !== "development" && supabaseEnv !== "production") return off("SUPABASE_ENV must be development or production");
  if (supabaseEnv !== expected) return off(`SUPABASE_ENV is ${supabaseEnv} but this deployment needs ${expected}`);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return off("SUPABASE_URL is not a valid URL");
  }
  // Plain http only for a Supabase running on this computer, and never on Vercel.
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && LOCAL_HOST.test(parsed.hostname) && !onVercel)) {
    return off("SUPABASE_URL must use https");
  }
  const projectRef = projectRefOf(url);
  const keyProblem = publishableKeyProblem(publishableKey, projectRef);
  if (keyProblem) return off(keyProblem);
  // The project must be the right one for this environment (src/lib/supabase/projects.ts).
  if (supabaseEnv === "production") {
    if (projects.development.includes(projectRef)) return off(`project ${projectRef} is a development project and can't be used in production`);
    if (!projects.production.includes(projectRef)) return off(`project ${projectRef} isn't listed as a production project in src/lib/supabase/projects.ts`);
  } else {
    if (projects.production.includes(projectRef)) return off(`project ${projectRef} is the production project and can't be used for development`);
    // Listed explicitly, like production: while the list is empty, accounts stay off locally and in Preview too.
    // (A Supabase on this computer is listed by its host, e.g. "127.0.0.1".)
    if (!projects.development.includes(projectRef)) return off(`project ${projectRef} isn't listed as a development project in src/lib/supabase/projects.ts`);
  }
  if (!turnstileSiteKey) return off("NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set");

  const upstashUrl = env.UPSTASH_REDIS_REST_URL?.trim();
  const upstashToken = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  const upstash = upstashUrl && upstashToken ? { url: upstashUrl, token: upstashToken } : null;
  const rateLimitSecret = env.RATE_LIMIT_SECRET?.trim() || null;
  // On Vercel the sign-in endpoints must be rate limited by a store every instance shares: no store, no accounts.
  if (onVercel && !upstash) return off("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required on Vercel");
  if (onVercel && (!rateLimitSecret || rateLimitSecret.length < 32)) return off("RATE_LIMIT_SECRET (32+ characters) is required on Vercel");

  return {
    enabled: true,
    url: parsed.origin,
    publishableKey,
    env: supabaseEnv,
    projectRef,
    turnstileSiteKey,
    upstash,
    rateLimitSecret,
  };
}

let cached: AccountsConfig | null = null;

/** The configuration for this process, read once. Logs whether accounts are on, the environment and the project ref. */
export function accountsConfig(): AccountsConfig {
  if (cached) return cached;
  cached = readAccountsConfig();
  if (cached.enabled) console.info(`[accounts] on: SUPABASE_ENV=${cached.env}, project=${cached.projectRef}`);
  else console.info(`[accounts] off: ${cached.reason}`);
  return cached;
}

/** For tests only. */
export function resetAccountsConfigForTests() {
  cached = null;
}
