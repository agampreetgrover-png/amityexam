import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Rate limits for the sign-in endpoints (and, later, AI, Drive and sync). On Vercel they live in Upstash Redis,
// shared by every function instance; a limit kept in one instance's memory is no limit there, so the memory store
// refuses to run on Vercel at all. When the shared store can't answer (unset, an error, a slow reply, or Upstash's
// own fail-open timeout), the request is refused: the endpoints fail closed.

type Window = `${number} ${"s" | "m" | "h"}`;
export const LIMITS = {
  "signup:ip": { limit: 5, window: "1 h" },
  "signup:email": { limit: 3, window: "1 h" },
  "login:ip": { limit: 20, window: "15 m" },
  // Per IP + email, not per email alone: that would let anyone lock a student out of their own account.
  "login:ip-email": { limit: 5, window: "15 m" },
  "resend:ip": { limit: 5, window: "1 h" },
  "resend:email": { limit: 3, window: "1 h" },
  "forgot:ip": { limit: 5, window: "1 h" },
  "forgot:email": { limit: 3, window: "1 h" },
  "verify:ip": { limit: 20, window: "15 m" },
  "reset:ip": { limit: 20, window: "15 m" },
  // Session refreshes from the middleware. Every refresh leaves from this server's IPs, so all students share
  // Supabase's per-IP /token budget (about 150 per 5 minutes by default): one client IP gets a small share, and
  // everyone together stays under that budget. Only sessions about to expire count (src/lib/supabase/middleware.ts),
  // so a student uses about one refresh an hour. If campus networks (many students, one IP) hit these, raise both
  // here and Supabase's token-refresh rate limit in its dashboard together.
  "session:ip": { limit: 10, window: "5 m" },
  "session:global": { limit: 120, window: "5 m" },
} as const satisfies Record<string, { limit: number; window: Window }>;
export type Bucket = keyof typeof LIMITS;

export type LimitResult = { ok: true } | { ok: false; reason: "limited"; retryAfter: number } | { ok: false; reason: "unavailable" };

type Env = Record<string, string | undefined>;

/**
 * The client's IP. On Vercel, x-vercel-forwarded-for / x-real-ip are set by Vercel itself, which overwrites any
 * forwarding headers a client sends ("to prevent IP spoofing", per Vercel's request-header docs). Anywhere else
 * these headers are whatever the client typed, so they are ignored and every request shares one "local" bucket.
 */
export function clientIp(headers: Headers, env: Env = process.env): string {
  if (!env.VERCEL) return "local";
  const raw = headers.get("x-vercel-forwarded-for") ?? headers.get("x-real-ip") ?? "";
  const ip = raw.split(",")[0].trim().slice(0, 64);
  if (!ip) return "unknown";
  return ip.includes(":") ? ipv6Prefix64(ip) : ip;
}

/**
 * An IPv6 address reduced to its /64 network ("2001:db8:1:2::/64"). One person usually gets a whole /64 and can
 * pick any address in it, so limiting single addresses would be no limit. Unparseable input is kept as it is.
 */
export function ipv6Prefix64(ip: string): string {
  const addr = ip.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  const halves = addr.split("::");
  if (halves.length > 2) return addr;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  // An embedded IPv4 tail (::ffff:1.2.3.4) counts as two groups.
  const groups = (g: string[]) => g.reduce((n, x) => n + (x.includes(".") ? 2 : 1), 0);
  const missing = 8 - groups(head) - groups(tail);
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return addr;
  const full = [...head, ...Array(missing).fill("0"), ...tail];
  // IPv4-mapped (::ffff:1.2.3.4): an IPv4 client, limited by its own IPv4 address, not lumped in with all the others.
  const last = full[full.length - 1];
  if (last.includes(".") && full.length === 7 && full.slice(0, 5).every((g) => /^0{1,4}$/.test(g)) && full[5] === "ffff") {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(last) ? last : addr;
  }
  if (!full.slice(0, 4).every((g) => /^[0-9a-f]{1,4}$/.test(g))) return addr;
  return `${full.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(":")}::/64`;
}

let localSecret: string | null = null;
/**
 * A bucket key for an email address that doesn't store the address: HMAC-SHA-256 of its lowercase form.
 * Returns null when it must not be computed, and the caller must then refuse the request (fail closed): on Vercel
 * that's whenever RATE_LIMIT_SECRET is missing or shorter than 32 characters. A per-process random secret would
 * give every function instance its own keys, so the per-email limits would never add up. Only on this computer,
 * where there is one process, does a random secret stand in.
 */
export function emailKey(email: string, secret: string | null, env: Env = process.env): string | null {
  let key = secret;
  if (!key || key.length < 32) {
    if (env.VERCEL) return null;
    key = secret || (localSecret ??= randomBytes(32).toString("hex"));
  }
  return createHmac("sha256", key).update(email.trim().toLowerCase()).digest("hex");
}

/** Which deployment the counters belong to, so Preview and Production never share them (even in one database). */
export const deploymentName = (env: Env = process.env) => env.VERCEL_ENV || (env.VERCEL ? "vercel" : "local");
export const ratelimitPrefix = (bucket: Bucket, env: Env = process.env) => `amityexams:${deploymentName(env)}:rl:${bucket}`;

interface Store {
  limit(bucket: Bucket, key: string): Promise<{ success: boolean; reset: number; timedOut?: boolean }>;
}

const windowMs = (w: Window) => {
  const [n, unit] = w.split(" ") as [string, "s" | "m" | "h"];
  return Number(n) * { s: 1000, m: 60_000, h: 3_600_000 }[unit];
};

/** Local development only: a fixed window per key, in this process's memory. */
export class MemoryStore implements Store {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(env: Env = process.env, private now: () => number = Date.now) {
    if (env.VERCEL) throw new Error("The in-memory rate limiter is for local development only; Vercel needs Upstash.");
  }
  async limit(bucket: Bucket, key: string) {
    const { limit, window } = LIMITS[bucket];
    const id = `${bucket}:${key}`;
    const t = this.now();
    let entry = this.hits.get(id);
    if (!entry || entry.resetAt <= t) {
      if (this.hits.size > 10_000) this.hits.clear(); // bounded: a flood of new keys can't grow it forever
      entry = { count: 0, resetAt: t + windowMs(window) };
      this.hits.set(id, entry);
    }
    entry.count++;
    return { success: entry.count <= limit, reset: entry.resetAt };
  }
}

const UPSTASH_TIMEOUT_MS = 2000;

export class UpstashStore implements Store {
  private limiters = new Map<Bucket, Ratelimit>();
  constructor(
    private redis: Redis,
    private env: Env = process.env,
  ) {}
  /** The Redis key prefix for a bucket: includes the deployment, so Preview and Production counters stay apart. */
  prefixFor(bucket: Bucket) {
    return ratelimitPrefix(bucket, this.env);
  }
  private limiter(bucket: Bucket) {
    let l = this.limiters.get(bucket);
    if (!l) {
      const { limit, window } = LIMITS[bucket];
      // Upstash *allows* a request when its own timeout fires (reason "timeout"); that answer is treated as unavailable.
      l = new Ratelimit({ redis: this.redis, limiter: Ratelimit.slidingWindow(limit, window), prefix: this.prefixFor(bucket), timeout: UPSTASH_TIMEOUT_MS, analytics: false });
      this.limiters.set(bucket, l);
    }
    return l;
  }
  async limit(bucket: Bucket, key: string) {
    const r = await this.limiter(bucket).limit(key);
    return { success: r.success, reset: r.reset, timedOut: r.reason === "timeout" };
  }
}

/** The store for this environment, or null when none may be used (Vercel without Upstash). */
export function createStore(env: Env = process.env): Store | null {
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (url && token) return new UpstashStore(new Redis({ url, token, retry: false }), env);
  if (env.VERCEL) return null;
  return new MemoryStore(env);
}

let store: Store | null | undefined;
const getStore = () => (store === undefined ? (store = createStore()) : store);

/** For tests only. */
export function setStoreForTests(s: Store | null | undefined) {
  store = s;
}

/**
 * Check every bucket; refused if any is over its limit. Any failure to get an answer within the time limit, or a
 * missing store, is "unavailable" and must be treated as a refusal (fail closed).
 */
export async function checkLimits(checks: { bucket: Bucket; key: string }[], timeoutMs = UPSTASH_TIMEOUT_MS + 500): Promise<LimitResult> {
  const s = getStore();
  if (!s) return { ok: false, reason: "unavailable" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), timeoutMs)));
  // In order, stopping at the first refusal: a request one bucket turns away mustn't use up the next one (a single
  // IP over its own limit would otherwise keep spending the shared, global allowance).
  const inOrder = async (): Promise<LimitResult> => {
    for (const c of checks) {
      const a = await s.limit(c.bucket, c.key);
      if (a.timedOut) return { ok: false, reason: "unavailable" };
      if (!a.success) return { ok: false, reason: "limited", retryAfter: Math.max(1, Math.ceil((a.reset - Date.now()) / 1000)) };
    }
    return { ok: true };
  };
  try {
    const result = await Promise.race([inOrder(), timeout]);
    return result === "timeout" ? { ok: false, reason: "unavailable" } : result;
  } catch (e) {
    console.error("[ratelimit] store error:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}
