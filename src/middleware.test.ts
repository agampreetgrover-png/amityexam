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
});
