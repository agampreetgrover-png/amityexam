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

  it("sends a page load on localhost to 127.0.0.1, where the data is, and nothing else", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("APP_PASSWORD", "");
    const nav = (url: string, host: string, extra: Record<string, string> = {}) =>
      middleware(new NextRequest(url, { headers: { host, "sec-fetch-mode": "navigate", ...extra } }));
    const moved = await nav("http://localhost:3000/subjects/view?id=4", "localhost:3000");
    expect(moved.status).toBe(200);
    expect(moved.headers.get("refresh")).toBe("0;url=http://127.0.0.1:3000/subjects/view?id=4");
    expect(moved.headers.get("location")).toBeNull();
    for (const [url, host] of [["http://127.0.0.1:3000/", "127.0.0.1:3000"], ["https://localhost.evil.example/", "localhost.evil.example"], ["https://exams.vercel.app/", "exams.vercel.app"]]) {
      expect((await nav(url, host)).headers.get("refresh")).toBeNull();
    }
    expect((await call("http://localhost:3000/api/ai/chat", "localhost:3000")).headers.get("refresh")).toBeNull();
  });

  it("still lets a laptop copy on 127.0.0.1 through", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("APP_PASSWORD", "");
    const res = await call("http://127.0.0.1:3000/api/ai/chat", "127.0.0.1:3000");
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});
