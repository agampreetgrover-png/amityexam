import { afterEach, describe, expect, it } from "vitest";
import { checkLimits, clientIp, createStore, emailKey, ipv6Prefix64, LIMITS, MemoryStore, ratelimitPrefix, setStoreForTests, UpstashStore } from "./ratelimit";

describe("session refresh limits", () => {
  it("keep everyone together under Supabase's default per-IP /token budget (~150 per 5 minutes)", () => {
    expect(LIMITS["session:global"]).toEqual({ limit: 120, window: "5 m" });
    expect(LIMITS["session:ip"]).toEqual({ limit: 10, window: "5 m" });
  });
});

afterEach(() => setStoreForTests(undefined));

const h = (o: Record<string, string>) => new Headers(o);

describe("clientIp", () => {
  it("on Vercel, uses the address Vercel itself sets", () => {
    expect(clientIp(h({ "x-vercel-forwarded-for": "203.0.113.7" }), { VERCEL: "1" })).toBe("203.0.113.7");
    expect(clientIp(h({ "x-real-ip": "203.0.113.8" }), { VERCEL: "1" })).toBe("203.0.113.8");
    expect(clientIp(h({ "x-vercel-forwarded-for": "203.0.113.7, 10.0.0.1" }), { VERCEL: "1" })).toBe("203.0.113.7");
    expect(clientIp(h({}), { VERCEL: "1" })).toBe("unknown");
  });
  it("on Vercel, prefers x-vercel-forwarded-for over the generic headers", () => {
    expect(clientIp(h({ "x-vercel-forwarded-for": "203.0.113.7", "x-real-ip": "198.51.100.1" }), { VERCEL: "1" })).toBe("203.0.113.7");
  });
  it("on Vercel, groups IPv6 clients by their /64 network (one person usually controls a whole /64)", () => {
    const v = (ip: string) => clientIp(h({ "x-vercel-forwarded-for": ip }), { VERCEL: "1" });
    expect(v("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(v("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(v("2001:0DB8:0001:0002:ffff::9")).toBe("2001:db8:1:2::/64");
    expect(v("2001:db8::5")).toBe("2001:db8:0:0::/64");
    expect(v("[2001:db8:1:2::7]")).toBe("2001:db8:1:2::/64");
    expect(v("2001:db8:1:2::1")).not.toBe(v("2001:db8:1:3::1"));
    expect(v("203.0.113.7")).toBe("203.0.113.7"); // IPv4 untouched
  });
  it("treats an IPv4-mapped address (::ffff:a.b.c.d) as that IPv4 client, not one shared bucket", () => {
    const v = (ip: string) => clientIp(h({ "x-vercel-forwarded-for": ip }), { VERCEL: "1" });
    expect(v("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(v("::FFFF:198.51.100.1")).toBe("198.51.100.1");
    expect(v("0:0:0:0:0:ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(v("::ffff:203.0.113.7")).not.toBe(v("::ffff:203.0.113.8"));
  });
  it("special IPv6 forms that carry an IPv4 client are keyed by that IPv4 address", () => {
    const v = (ip: string) => clientIp(h({ "x-vercel-forwarded-for": ip }), { VERCEL: "1" });
    expect(v("::ffff:102:304")).toBe("1.2.3.4"); // IPv4-mapped, written in hex
    expect(v("::ffff:cb00:7107")).toBe("203.0.113.7");
    expect(v("::ffff:0:203.0.113.7")).toBe("203.0.113.7"); // IPv4-translated
    expect(v("::203.0.113.7")).toBe("203.0.113.7"); // IPv4-compatible (deprecated)
    expect(v("::ffff:102:304")).not.toBe(v("::ffff:102:305"));
  });
  it("::, ::1 and the rest of 0::/64 each get their own key instead of sharing 0:0:0:0::/64", () => {
    const v = (ip: string) => clientIp(h({ "x-vercel-forwarded-for": ip }), { VERCEL: "1" });
    expect(v("::")).toBe("0:0:0:0:0:0:0:0");
    expect(v("::1")).toBe("0:0:0:0:0:0:0:1");
    expect(v("::1")).not.toBe(v("::"));
    expect(v("::1:0:0:1")).toBe("0:0:0:0:1:0:0:1");
    expect(v("::1:0:0:1")).not.toBe(v("::1:0:0:2"));
  });
  it("rejects malformed addresses (checked by Node's own parser): they share one 'unknown' key instead of getting their own", () => {
    for (const bad of ["1.2.3.4::5", "1::2::3", "zz:1:2:3:4:5:6:7", "1:2:3:4:5:6:7:8:9", "1.2.3.4:5::", "::1.2.3", "::256.1.1.1", "12345::", "::ffff:1.2.3.4.5", "", "not-an-ip"]) {
      expect(ipv6Prefix64(bad), bad).toBe("unknown");
    }
    const v = (ip: string) => clientIp(h({ "x-vercel-forwarded-for": ip }), { VERCEL: "1" });
    for (const bad of ["1.2.3.4::5", "256.1.1.1", "01.2.3.4", "1.2.3", "1.2.3.4.5", "999.999.999.999", "hello"]) {
      expect(v(bad), bad).toBe("unknown");
    }
    expect(v("1.2.3.4")).toBe("1.2.3.4"); // a well-formed one still gets its own key
  });
  it("off Vercel, ignores forwarding headers (anyone can type them) and uses one local bucket", () => {
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8", "x-vercel-forwarded-for": "9.9.9.9" }), {})).toBe("local");
  });
});

describe("emailKey", () => {
  it("is the same for the same address however it's typed, and never contains the address", () => {
    const k = emailKey("  Student@Example.test ", "s".repeat(32));
    expect(k).toBe(emailKey("student@example.test", "s".repeat(32)));
    expect(k).not.toContain("student");
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });
  it("depends on the secret", () => {
    expect(emailKey("a@b.test", "x".repeat(32))).not.toBe(emailKey("a@b.test", "y".repeat(32)));
  });
  it("on Vercel, refuses (null) without a 32+ character secret instead of inventing one per instance", () => {
    expect(emailKey("a@b.test", null, { VERCEL: "1" })).toBeNull();
    expect(emailKey("a@b.test", "short", { VERCEL: "1" })).toBeNull();
    expect(emailKey("a@b.test", "s".repeat(32), { VERCEL: "1" })).toMatch(/^[0-9a-f]{64}$/);
  });
  it("on this computer, still works without a secret (one process, so one stand-in secret)", () => {
    const a = emailKey("a@b.test", null, {});
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(emailKey("a@b.test", null, {})).toBe(a);
  });
});

describe("rate-limit key prefixes", () => {
  it("separate Preview, Production and local counters, even in one Upstash database", () => {
    const preview = ratelimitPrefix("login:ip", { VERCEL: "1", VERCEL_ENV: "preview" });
    const production = ratelimitPrefix("login:ip", { VERCEL: "1", VERCEL_ENV: "production" });
    const local = ratelimitPrefix("login:ip", {});
    expect(preview).toBe("amityexams:preview:rl:login:ip");
    expect(production).toBe("amityexams:production:rl:login:ip");
    expect(local).toBe("amityexams:local:rl:login:ip");
    expect(new Set([preview, production, local]).size).toBe(3);
  });
  it("are what the Upstash store actually uses", () => {
    const env = { VERCEL: "1", VERCEL_ENV: "preview", UPSTASH_REDIS_REST_URL: "https://example.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" };
    const s = createStore(env);
    expect(s).toBeInstanceOf(UpstashStore);
    expect((s as UpstashStore).prefixFor("signup:email")).toBe("amityexams:preview:rl:signup:email");
    expect((createStore({ ...env, VERCEL_ENV: "production" }) as UpstashStore).prefixFor("signup:email")).toBe("amityexams:production:rl:signup:email");
  });
});

describe("Vercel is detected the same way everywhere (VERCEL or VERCEL_ENV)", () => {
  const onlyEnv = { VERCEL_ENV: "preview" };
  it("client IP: with only VERCEL_ENV set, Vercel's own header is used (not one shared local bucket)", () => {
    expect(clientIp(h({ "x-vercel-forwarded-for": "203.0.113.7" }), onlyEnv)).toBe("203.0.113.7");
  });
  it("store selection: with only VERCEL_ENV set, the memory store refuses to run and no store is chosen without Upstash", () => {
    expect(() => new MemoryStore(onlyEnv)).toThrow(/local development only/);
    expect(createStore(onlyEnv)).toBeNull();
    expect(createStore({ VERCEL_ENV: "production" })).toBeNull();
  });
  it("email keys and key prefixes: with only VERCEL_ENV set, no stand-in secret and a Vercel prefix", () => {
    expect(emailKey("a@b.test", null, onlyEnv)).toBeNull();
    expect(ratelimitPrefix("login:ip", onlyEnv)).toBe("amityexams:preview:rl:login:ip");
  });
  it("neither variable set: this computer", () => {
    expect(clientIp(h({ "x-vercel-forwarded-for": "203.0.113.7" }), {})).toBe("local");
    expect(createStore({})).toBeInstanceOf(MemoryStore);
  });
});

describe("stores", () => {
  it("the memory store refuses to run on Vercel", () => {
    expect(() => new MemoryStore({ VERCEL: "1" })).toThrow(/local development only/);
  });
  it("Vercel without Upstash has no store at all; locally it falls back to memory", () => {
    expect(createStore({ VERCEL: "1" })).toBeNull();
    expect(createStore({})).toBeInstanceOf(MemoryStore);
  });
  it("the memory store counts per bucket and key, and resets after the window", async () => {
    let now = 1_000_000;
    const s = new MemoryStore({}, () => now);
    const max = LIMITS["login:ip-email"].limit;
    for (let i = 0; i < max; i++) expect((await s.limit("login:ip-email", "k")).success).toBe(true);
    expect((await s.limit("login:ip-email", "k")).success).toBe(false);
    expect((await s.limit("login:ip-email", "other")).success).toBe(true);
    now += 15 * 60_000;
    expect((await s.limit("login:ip-email", "k")).success).toBe(true);
  });
});

describe("checkLimits fails closed", () => {
  it("allows while under every limit", async () => {
    setStoreForTests(new MemoryStore({}));
    expect(await checkLimits([{ bucket: "signup:ip", key: "a" }, { bucket: "signup:email", key: "b" }])).toEqual({ ok: true });
  });
  it("after giving up on a slow answer (timeout), doesn't go on to use up later buckets in the background", async () => {
    const asked: string[] = [];
    setStoreForTests({
      limit: (b) => {
        asked.push(b);
        return new Promise((r) => setTimeout(() => r({ success: true, reset: 0 }), b === "session:ip" ? 120 : 0));
      },
    });
    expect(await checkLimits([{ bucket: "session:ip", key: "a" }, { bucket: "session:global", key: "all" }], 50)).toEqual({ ok: false, reason: "unavailable" });
    await new Promise((r) => setTimeout(r, 200)); // the slow first answer arrives after the timeout
    expect(asked).toEqual(["session:ip"]);
  });
  it("checks in order and stops at the first refusal, so later buckets aren't used up", async () => {
    const asked: string[] = [];
    setStoreForTests({ limit: async (b) => (asked.push(b), { success: b !== "session:ip", reset: Date.now() + 1000 }) });
    expect(await checkLimits([{ bucket: "session:ip", key: "a" }, { bucket: "session:global", key: "all" }])).toMatchObject({ ok: false, reason: "limited" });
    expect(asked).toEqual(["session:ip"]);
  });
  it("refuses when any bucket is over, with a Retry-After in seconds", async () => {
    setStoreForTests({ limit: async (b) => ({ success: b !== "signup:email", reset: Date.now() + 30_000 }) });
    const r = await checkLimits([{ bucket: "signup:ip", key: "a" }, { bucket: "signup:email", key: "b" }]);
    expect(r).toMatchObject({ ok: false, reason: "limited" });
    expect(r.ok === false && r.reason === "limited" && r.retryAfter).toBeGreaterThanOrEqual(29);
  });
  it("no store (Vercel without Upstash) → unavailable", async () => {
    setStoreForTests(null);
    expect(await checkLimits([{ bucket: "login:ip", key: "a" }])).toEqual({ ok: false, reason: "unavailable" });
  });
  it("the store erroring → unavailable", async () => {
    setStoreForTests({ limit: async () => Promise.reject(new Error("ECONNRESET")) });
    expect(await checkLimits([{ bucket: "login:ip", key: "a" }])).toEqual({ ok: false, reason: "unavailable" });
  });
  it("the store too slow → unavailable", async () => {
    setStoreForTests({ limit: () => new Promise(() => {}) });
    expect(await checkLimits([{ bucket: "login:ip", key: "a" }], 50)).toEqual({ ok: false, reason: "unavailable" });
  });
  it("Upstash's own fail-open timeout (success: true, reason timeout) → unavailable", async () => {
    setStoreForTests({ limit: async () => ({ success: true, reset: 0, timedOut: true }) });
    expect(await checkLimits([{ bucket: "login:ip", key: "a" }])).toEqual({ ok: false, reason: "unavailable" });
  });
});
