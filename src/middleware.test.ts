import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { middleware } from "./middleware";

const call = (url: string, host: string) =>
  middleware(new NextRequest(url, { method: "POST", headers: { host, "sec-fetch-site": "same-origin" } }));

afterEach(() => vi.unstubAllEnvs());

describe("middleware on a public deployment", () => {
  it("keeps the AI API shut on Vercel until APP_PASSWORD is set", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("APP_PASSWORD", "");
    const res = await call("https://exams.vercel.app/api/ai/chat", "exams.vercel.app");
    expect(res.status).toBe(503);
  });

  it("asks for the password on Vercel once one is set", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("APP_PASSWORD", "a long random password");
    const res = await call("https://exams.vercel.app/api/ai/chat", "exams.vercel.app");
    expect(res.status).toBe(401);
  });

  it("still lets a laptop copy on 127.0.0.1 through", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("APP_PASSWORD", "");
    const res = await call("http://127.0.0.1:3000/api/ai/chat", "127.0.0.1:3000");
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  // The API lock uses the shared Vercel detection (src/lib/vercel.ts): either variable means Vercel.
  for (const [label, env] of [
    ["VERCEL only", { VERCEL: "1", VERCEL_ENV: "" }],
    ["VERCEL_ENV only", { VERCEL: "", VERCEL_ENV: "preview" }],
    ["both", { VERCEL: "1", VERCEL_ENV: "production" }],
    ["a malformed VERCEL_ENV only", { VERCEL: "", VERCEL_ENV: "Production" }],
  ] as const) {
    it(`keeps the AI API shut without APP_PASSWORD when Vercel is recognised by ${label}`, async () => {
      vi.stubEnv("APP_PASSWORD", "");
      vi.stubEnv("VERCEL", env.VERCEL);
      vi.stubEnv("VERCEL_ENV", env.VERCEL_ENV);
      const res = await call("https://exams.vercel.app/api/ai/chat", "exams.vercel.app");
      expect(res.status).toBe(503);
    });
  }

  it("neither variable set: this computer, where the API isn't shut by that rule", async () => {
    vi.stubEnv("APP_PASSWORD", "");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    const res = await call("http://127.0.0.1:3000/api/ai/chat", "127.0.0.1:3000");
    expect(res.status).not.toBe(503);
  });
});
