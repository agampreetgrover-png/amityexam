import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS, setStoreForTests, type Bucket } from "@/lib/ratelimit";
import { resetAccountsConfigForTests } from "@/lib/supabase/env";
import { captchaToken, sessionBody, type Reply } from "@/test/fake-supabase";
import { post, setupAccounts, teardownAccounts, type Harness } from "@/test/auth-routes";
import { POST as forgot } from "./forgot/route";
import { POST as login } from "./login/route";
import { POST as resend } from "./resend/route";
import { POST as signup } from "./signup/route";
import { POST as verify } from "./verify/route";

vi.mock("@/lib/supabase/projects", () => ({ SUPABASE_PROJECTS: { development: ["devrefaaaaaaaaaaaaaa"], production: [], local: [] } }));

// H1: every call to Supabase leaves from this server's IPs, so Supabase counts all students together. Per-IP limits
// alone don't protect that shared budget: one attacker with a block of IPv6 addresses gets a separate per-IP bucket
// for every /64. These run as a Vercel Preview (where the client IP comes from Vercel's own header) with a store that
// really counts, and check that the global caps hold, and that only requests with a solved CAPTCHA can use them.

const GOOD = "correct horse battery";

/** Counts like the real limiter (a fixed window is enough here): per bucket and key, LIMITS[bucket].limit each. */
function countingStore() {
  const hits = new Map<string, number>();
  const checks: { bucket: Bucket; key: string }[] = [];
  return {
    checks,
    count: (bucket: Bucket) => checks.filter((c) => c.bucket === bucket).length,
    limit: async (bucket: Bucket, key: string) => {
      checks.push({ bucket, key });
      const id = `${bucket}:${key}`;
      const n = (hits.get(id) ?? 0) + 1;
      hits.set(id, n);
      return { success: n <= LIMITS[bucket].limit, reset: Date.now() + 60_000 };
    },
  };
}

let h: Harness;
let store: ReturnType<typeof countingStore>;
beforeEach(() => {
  h = setupAccounts();
  // A Vercel Preview: Upstash and the email-key secret are required there (the counting store stands in for Upstash).
  for (const [k, v] of Object.entries({ VERCEL: "1", VERCEL_ENV: "preview", UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t", RATE_LIMIT_SECRET: "s".repeat(32) })) vi.stubEnv(k, v);
  resetAccountsConfigForTests();
  store = countingStore();
  setStoreForTests(store);
});
afterEach(teardownAccounts);

/** Client number i, each in its own IPv6 /64 (as Vercel reports the client address). */
const fromNet = (i: number) => ({ "x-vercel-forwarded-for": `2001:db8:${i.toString(16)}:1::abcd` });
const supabaseCalls = (endpoint: string) => h.server.calls.filter((c) => c.endpoint === endpoint).length;

describe("global caps hold against floods from many IPv6 ranges", () => {
  it("login: 40 clients in 40 different /64s, each under its own per-IP limit → only login:global's 25 reach Supabase", async () => {
    const cap = LIMITS["login:global"].limit;
    for (let i = 0; i < cap; i++) h.server.reply("password", { status: 400, body: { code: "invalid_credentials" } });
    const statuses: number[] = [];
    for (let i = 0; i < 40; i++) {
      const res = await login(post("/auth/login", { email: `victim${i % 3}@example.test`, password: GOOD }, { headers: fromNet(i) }));
      statuses.push(res.status);
    }
    expect(new Set(store.checks.filter((c) => c.bucket === "login:ip").map((c) => c.key)).size).toBe(40); // 40 separate per-IP buckets
    expect(supabaseCalls("password")).toBe(cap);
    expect(statuses.filter((s) => s === 429)).toHaveLength(40 - cap);
    expect(statuses.slice(cap).every((s) => s === 429)).toBe(true);
  });

  it("email: sign-up, resend and forgot share one global budget, whichever route and /64 the flood uses", async () => {
    const cap = LIMITS["email:global"].limit;
    for (let i = 0; i < 60; i++) {
      h.server.reply("signup", { status: 200, body: {} });
      h.server.reply("resend", { status: 200, body: {} });
      h.server.reply("recover", { status: 200, body: {} });
    }
    const routes = [
      (i: number) => signup(post("/auth/signup", { email: `new${i}@example.test`, password: GOOD }, { headers: fromNet(i) })),
      (i: number) => resend(post("/auth/resend", { email: `new${i}@example.test` }, { headers: fromNet(i) })),
      (i: number) => forgot(post("/auth/forgot", { email: `new${i}@example.test` }, { headers: fromNet(i) })),
    ];
    const limited: number[] = [];
    for (let i = 0; i < 45; i++) {
      const res = await routes[i % 3](i);
      if (res.status === 429) limited.push(i);
    }
    expect(supabaseCalls("signup") + supabaseCalls("resend") + supabaseCalls("recover")).toBe(cap);
    expect(limited).toHaveLength(45 - cap);
  });

  it("verify: links from many /64s → only verify:global's 25 reach Supabase", async () => {
    const cap = LIMITS["verify:global"].limit;
    for (let i = 0; i < 40; i++) h.server.reply("verify", { status: 403, body: { code: "otp_expired" } });
    let limited = 0;
    for (let i = 0; i < 40; i++) {
      const res = await verify(post("/auth/verify", { tokenHash: `${"a".repeat(40)}${i}`, type: "signup" }, { headers: fromNet(i) }));
      if (res.status === 429) limited++;
    }
    expect(supabaseCalls("verify")).toBe(cap);
    expect(limited).toBe(40 - cap);
  });

  it("a flood without solved CAPTCHAs never touches the global budget, so real students still get in", async () => {
    for (let i = 0; i < 40; i++) {
      const res = await login(post("/auth/login", { email: "victim@example.test", password: GOOD, captchaToken: "not-a-real-token" }, { headers: fromNet(i) }));
      expect((await res.json()).error.code).toBe("captcha_failed");
    }
    expect(store.count("login:global")).toBe(0);
    expect(h.server.calls).toHaveLength(0);
    // A real student afterwards: through.
    h.server.reply("password", { status: 200, body: sessionBody(3600) });
    expect((await login(post("/auth/login", { email: "student@example.test", password: GOOD }, { headers: fromNet(999) }))).status).toBe(200);
  });
});

describe("the CAPTCHA is mandatory, and checked by this server", () => {
  const routes = [
    ["/auth/login", login, { email: "a@example.test", password: GOOD }, "password", "login"],
    ["/auth/signup", signup, { email: "a@example.test", password: GOOD }, "signup", "signup"],
    ["/auth/resend", resend, { email: "a@example.test" }, "resend", "resend"],
    ["/auth/forgot", forgot, { email: "a@example.test" }, "recover", "forgot"],
  ] as const;

  for (const [path, handler, body, endpoint] of routes) {
    it(`${path}: a missing or malformed token → 400 captcha_failed; nothing counted, Cloudflare and Supabase never asked`, async () => {
      for (const captcha of [undefined, "", 42, ["x"], "x".repeat(2049)]) {
        const res = await handler(post(path, { ...body, captchaToken: captcha }));
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ error: { code: "captcha_failed" } });
      }
      expect(store.checks).toHaveLength(0);
      expect(h.server.captchaCalls).toHaveLength(0);
      expect(supabaseCalls(endpoint)).toBe(0);
    });

    it(`${path}: a token Cloudflare refuses → 403 captcha_failed; the global cap untouched, Supabase never asked`, async () => {
      const res = await handler(post(path, { ...body, captchaToken: "refused-by-cloudflare" }));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: { code: "captcha_failed" } });
      expect(store.checks.some((c) => c.bucket.endsWith(":global"))).toBe(false);
      expect(h.server.calls).toHaveLength(0);
    });

    it(`${path}: Cloudflare unreachable, failing or slow → 503 unavailable (fails closed), Supabase never asked`, async () => {
      for (const reply of ["network", { status: 500, body: {} }, { status: 200, body: { success: false, "error-codes": ["internal-error"] } }] as Reply[]) {
        h.server.replyCaptcha(reply);
        const res = await handler(post(path, body));
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ error: { code: "unavailable" } });
      }
      expect(h.server.calls).toHaveLength(0);
    });
  }

  it("a token solved for another form, or on another site, is refused", async () => {
    expect((await login(post("/auth/login", { email: "a@example.test", password: GOOD, captchaToken: captchaToken("signup") }))).status).toBe(403);
    expect((await login(post("/auth/login", { email: "a@example.test", password: GOOD, captchaToken: captchaToken("login", "evil.example") }))).status).toBe(403);
    expect(h.server.calls).toHaveLength(0);
  });

  it("the token is checked once, here, and never forwarded to Supabase", async () => {
    h.server.reply("password", { status: 200, body: sessionBody(3600) });
    expect((await login(post("/auth/login", { email: "a@example.test", password: GOOD }))).status).toBe(200);
    expect(h.server.captchaCalls).toHaveLength(1);
    expect(JSON.stringify(h.server.calls[0].body)).not.toMatch(/captcha/i);
  });

  it("order: per-IP limits first (a refused IP costs Cloudflare nothing), then the CAPTCHA, then the global cap", async () => {
    h.server.reply("password", { status: 200, body: sessionBody(3600) });
    await login(post("/auth/login", { email: "a@example.test", password: GOOD }, { headers: fromNet(1) }));
    expect(store.checks.map((c) => c.bucket)).toEqual(["login:ip", "login:ip-email", "login:global"]);
    // Over the per-IP limit: refused before Cloudflare is asked.
    const before = h.server.captchaCalls.length;
    for (let i = 0; i < LIMITS["login:ip"].limit + 2; i++) await login(post("/auth/login", { email: `x${i}@example.test`, password: GOOD }, { headers: fromNet(2) }));
    expect(h.server.captchaCalls.length - before).toBe(LIMITS["login:ip"].limit);
  });
});
