import "server-only";
import { deploymentOf } from "@/lib/vercel";
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
      /**
       * Server-only Turnstile secret: this server checks every sign-in, sign-up and email request's CAPTCHA itself
       * (src/lib/auth/captcha.ts). Required: without it accounts stay off, so there is no way to run them unprotected.
       */
      turnstileSecretKey: string;
      /** Shared rate-limit store: required on Vercel, optional elsewhere (local development uses memory). */
      upstash: { url: string; token: string } | null;
      /** Keys rate-limit buckets by email without storing the address. Generated per process when unset locally. */
      rateLimitSecret: string | null;
    }
  | { enabled: false; reason: string };

type Env = Record<string, string | undefined>;

/**
 * What SUPABASE_URL points at. Only two shapes are accepted, and nothing in between:
 *   - a standard Supabase project: https://<project-ref>.supabase.co, where the ref is exactly 20 lowercase letters or
 *     digits (Supabase's format), with no port, user name, password, path, query or fragment;
 *   - a Supabase running on this computer (localhost, 127.0.0.1 or [::1], http or https, any port), and only off
 *     Vercel: Preview and Production never accept a local address.
 * Custom domains are deliberately not supported. Both kinds still have to be listed in projects.ts, each in its own
 * list (real refs under development/production, local hosts under local), so neither can stand in for the other.
 * Rejected shapes the old parser let through, among others: 127.0.0.1.supabase.co (a dotted ref that read as
 * "127.0.0.1"), a single-word host such as https://devref123, a trailing-dot host, and localhost.supabase.co.
 */
export type SupabaseAddress = { kind: "project" | "local"; ref: string; origin: string } | { kind: "invalid"; reason: string };

const PROJECT_SUFFIX = ".supabase.co";
/** Supabase project refs: 20 lowercase letters or digits. Anything else can't be a real project. */
const PROJECT_REF = /^[a-z0-9]{20}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SHAPE = "SUPABASE_URL must be https://<project-ref>.supabase.co (or a Supabase on this computer, off Vercel)";

export function parseSupabaseUrl(raw: string, { onVercel }: { onVercel: boolean }): SupabaseAddress {
  const invalid = (reason: string): SupabaseAddress => ({ kind: "invalid", reason });
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return invalid("SUPABASE_URL is not a valid URL");
  }
  if (u.username || u.password) return invalid("SUPABASE_URL must not contain a user name or password");
  if (u.pathname !== "/" || u.search || u.hash) return invalid("SUPABASE_URL must be the project address only, with no path, query or fragment");
  const host = u.hostname; // lowercased by the URL parser; IPv6 keeps its brackets; a trailing dot is kept

  if (LOCAL_HOSTS.has(host)) {
    if (onVercel) return invalid("SUPABASE_URL points at this computer, which is never allowed on Vercel");
    if (u.protocol !== "http:" && u.protocol !== "https:") return invalid(SHAPE);
    return { kind: "local", ref: host, origin: u.origin };
  }
  if (u.protocol !== "https:") return invalid("SUPABASE_URL must use https");
  if (u.port) return invalid("SUPABASE_URL must not name a port");
  if (!host.endsWith(PROJECT_SUFFIX)) return invalid(`${SHAPE}; custom domains aren't supported`);
  const ref = host.slice(0, -PROJECT_SUFFIX.length);
  if (!PROJECT_REF.test(ref)) return invalid(`${SHAPE}; the project ref must be exactly 20 lowercase letters or digits`);
  return { kind: "project", ref, origin: u.origin };
}

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

/**
 * Cloudflare's published Turnstile test keys: site keys like 1x00000000000000000000AA and secrets like
 * 1x0000000000000000000000000000000AA (prefix 1x/2x/3x, zeros, two capital letters). Real keys start with 0x.
 */
export const isTurnstileTestKey = (key: string) => /^[1-3]x0+[A-Z]{2}$/.test(key);

export function readAccountsConfig(env: Env = process.env, projects = SUPABASE_PROJECTS): AccountsConfig {
  const off = (reason: string): AccountsConfig => ({ enabled: false, reason });
  // Which deployment this is (src/lib/vercel.ts), failing closed: a recognisably-Vercel deployment whose VERCEL_ENV is
  // missing or not exactly development/preview/production is never treated as this computer or as development.
  const deployment = deploymentOf(env);
  if (deployment.kind === "unknown") return off(`can't tell which deployment this is: ${deployment.reason}`);
  const onVercel = deployment.kind === "vercel"; // local Supabase addresses are never accepted there
  const expected: SupabaseEnvName = deployment.kind === "vercel" && deployment.env === "production" ? "production" : "development";

  const url = env.SUPABASE_URL?.trim();
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  const supabaseEnv = env.SUPABASE_ENV?.trim();
  const turnstileSiteKey = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  if (!url || !publishableKey) return off("SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY is not set");
  if (supabaseEnv !== "development" && supabaseEnv !== "production") return off("SUPABASE_ENV must be development or production");
  if (supabaseEnv !== expected) return off(`SUPABASE_ENV is ${supabaseEnv} but this deployment needs ${expected}`);

  const address = parseSupabaseUrl(url, { onVercel });
  if (address.kind === "invalid") return off(address.reason);
  if (address.kind === "local" && supabaseEnv === "production") return off("a Supabase on this computer can't be the production project");
  const projectRef = address.ref;
  const keyProblem = publishableKeyProblem(publishableKey, projectRef);
  if (keyProblem) return off(keyProblem);
  // The project must be listed for this environment (src/lib/supabase/projects.ts), each kind in its own list: a
  // local host is looked up only among local entries, a real ref only among development/production refs.
  if (address.kind === "local") {
    if (!projects.local.includes(projectRef)) return off(`${projectRef} isn't listed as a local Supabase in src/lib/supabase/projects.ts`);
  } else if (supabaseEnv === "production") {
    if (projects.development.includes(projectRef)) return off(`project ${projectRef} is a development project and can't be used in production`);
    if (!projects.production.includes(projectRef)) return off(`project ${projectRef} isn't listed as a production project in src/lib/supabase/projects.ts`);
  } else {
    if (projects.production.includes(projectRef)) return off(`project ${projectRef} is the production project and can't be used for development`);
    // Listed explicitly, like production: while the list is empty, accounts stay off locally and in Preview too.
    if (!projects.development.includes(projectRef)) return off(`project ${projectRef} isn't listed as a development project in src/lib/supabase/projects.ts`);
  }
  if (!turnstileSiteKey) return off("NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set");
  // The CAPTCHA is checked here, by this server, never left to a setting in Supabase that the app can't see: no
  // secret, no accounts. Cloudflare's test keys (always pass / always fail) are fine for development and Preview,
  // never for Production.
  const turnstileSecretKey = env.TURNSTILE_SECRET_KEY?.trim();
  if (!turnstileSecretKey) return off("TURNSTILE_SECRET_KEY is not set");
  if (deployment.kind === "vercel" && deployment.env === "production" && (isTurnstileTestKey(turnstileSiteKey) || isTurnstileTestKey(turnstileSecretKey))) {
    return off("Cloudflare's Turnstile test keys can't be used in Production");
  }

  const upstashUrl = env.UPSTASH_REDIS_REST_URL?.trim();
  const upstashToken = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  const upstash = upstashUrl && upstashToken ? { url: upstashUrl, token: upstashToken } : null;
  const rateLimitSecret = env.RATE_LIMIT_SECRET?.trim() || null;
  // On Vercel the sign-in endpoints must be rate limited by a store every instance shares: no store, no accounts.
  if (onVercel && !upstash) return off("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required on Vercel");
  if (onVercel && (!rateLimitSecret || rateLimitSecret.length < 32)) return off("RATE_LIMIT_SECRET (32+ characters) is required on Vercel");

  return {
    enabled: true,
    url: address.origin,
    publishableKey,
    env: supabaseEnv,
    projectRef,
    turnstileSiteKey,
    turnstileSecretKey,
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
