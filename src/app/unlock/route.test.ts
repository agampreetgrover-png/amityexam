import { afterAll, describe, expect, it, vi } from "vitest";

vi.stubEnv("VERCEL", "1");
vi.stubEnv("APP_PASSWORD", "right-password");
afterAll(() => vi.unstubAllEnvs());

const { POST } = await import("./route");

const guess = (ip: string, password = "wrong") => {
  const body = new FormData();
  body.set("password", password);
  return POST(new Request("http://127.0.0.1:3000/unlock", { method: "POST", body, headers: { "x-real-ip": ip } }));
};

describe("POST /unlock rate limit", () => {
  it("keeps the shared cap when refused requests come from more than 10,000 addresses", async () => {
    // 30 wrong guesses (3 addresses x 10) reach the cap on everyone together.
    const first = await Promise.all(Array.from({ length: 30 }, (_, i) => guess(`10.0.0.${i % 3}`)));
    expect(first.every((r) => r.status === 401)).toBe(true);

    // Fresh addresses are all refused, and their number can't wipe the shared bucket.
    for (let i = 0; i < 10_050; i++) {
      const res = await guess(`2001:db8::${i.toString(16)}`);
      if (res.status !== 429) throw new Error(`request ${i} from a fresh address got ${res.status}, not 429`);
    }
    expect((await guess("2001:db8:ffff::1")).status).toBe(429);
  }, 30_000);
});
