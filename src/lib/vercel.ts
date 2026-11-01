// Where this code is running. Vercel sets both VERCEL and VERCEL_ENV on every deployment.

type Env = Record<string, string | undefined>;

/**
 * Whether this looks like Vercel at all: either variable is enough, so a missing one can never make a Vercel
 * deployment be treated like this computer (local Supabase addresses, the in-memory rate limiter, trusting no
 * forwarding headers, the API left open without a password). An empty value counts as unset.
 */
export const isVercel = (env: Env = process.env) => !!env.VERCEL || !!env.VERCEL_ENV;

export type VercelEnvName = "development" | "preview" | "production";
export type Deployment =
  | { kind: "local" }
  | { kind: "vercel"; env: VercelEnvName }
  /** Recognisably Vercel, but which environment it is can't be told: nothing environment-specific may run. */
  | { kind: "unknown"; reason: string };

const VERCEL_ENVS: readonly string[] = ["development", "preview", "production"];

/**
 * Which deployment this is, failing closed. VERCEL_ENV must be exactly "development", "preview" or "production":
 * "Production", " production" or "staging" are not guessed at, and VERCEL without VERCEL_ENV isn't taken to be
 * this computer. Only when neither variable is set is it this computer.
 */
export function deploymentOf(env: Env = process.env): Deployment {
  const vercelEnv = env.VERCEL_ENV;
  if (!env.VERCEL && !vercelEnv) return { kind: "local" };
  if (!vercelEnv) return { kind: "unknown", reason: "VERCEL is set but VERCEL_ENV is missing" };
  if (!VERCEL_ENVS.includes(vercelEnv)) return { kind: "unknown", reason: `VERCEL_ENV must be exactly development, preview or production (got ${JSON.stringify(vercelEnv.slice(0, 40))})` };
  return { kind: "vercel", env: vercelEnv as VercelEnvName };
}
