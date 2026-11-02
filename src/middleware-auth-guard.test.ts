import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { middleware } from "./middleware";

// S1.2a: the middleware refuses state-changing /auth/* requests that aren't same-origin JSON, before the password
// gate, the session refresh or any handler. The /api rules are unchanged (checked at the end).

const HOST = "127.0.0.1:3000";
const ORIGIN = `http://${HOST}`;
const send = (path: string, method: string, headers: Record<string, string>) =>
  middleware(new NextRequest(`${ORIGIN}${path}`, { method, headers: { host: HOST, ...headers }, body: method === "GET" ? undefined : "{}" }));
const ours = { "sec-fetch-site": "same-origin", origin: ORIGIN, "content-type": "application/json" };
const passed = (res: Response) => res.headers.get("x-middleware-next") === "1";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("middleware: non-GET /auth/*", () => {
  it("our own JSON POST passes on to the handler", async () => {
    expect(passed(await send("/auth/login", "POST", ours))).toBe(true);
    expect(passed(await send("/auth/signout", "POST", ours))).toBe(true);
  });
  it("a cross-site POST is refused with 403 blocked (JSON, no-store)", async () => {
    for (const path of ["/auth/login", "/auth/signup", "/auth/signout", "/auth/update-password", "/auth/anything/new"]) {
      const res = await send(path, "POST", { ...ours, "sec-fetch-site": "cross-site", origin: "https://evil.example" });
      expect(res.status).toBe(403);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ error: { code: "blocked" } });
    }
  });
  it("a POST without any origin header is refused (unlike /api, which still accepts it)", async () => {
    expect((await send("/auth/login", "POST", { "content-type": "application/json" })).status).toBe(403);
  });
  it("a same-origin POST that isn't JSON is refused with 415", async () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded"]) {
      expect((await send("/auth/login", "POST", { ...ours, "content-type": type })).status).toBe(415);
    }
  });
  it("GET /auth/session and the /auth/confirm page are not affected", async () => {
    expect(passed(await send("/auth/session", "GET", { "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(passed(await send("/auth/confirm", "GET", { "sec-fetch-site": "none" }))).toBe(true);
  });
  it("refuses before the APP_PASSWORD gate (a locked copy still says 403, not 401)", async () => {
    vi.stubEnv("APP_PASSWORD", "a long random password");
    expect((await send("/auth/login", "POST", { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await send("/auth/login", "POST", ours)).status).toBe(401); // ours, but locked: the gate still applies
  });
  it("a locked copy answers /auth/* requests in the auth client's shape, read as 'blocked' (never as 'sent')", async () => {
    vi.stubEnv("APP_PASSWORD", "a long random password");
    const { toResult } = await import("@/lib/auth/client");
    for (const res of [await send("/auth/forgot", "POST", ours), await send("/auth/session", "GET", { "sec-fetch-site": "same-origin" })]) {
      expect(res.status).toBe(401);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await toResult(res.clone())).toEqual({ ok: false, code: "blocked" });
    }
    // A page load (the /auth/confirm page) still gets the password form.
    const page = await send("/auth/confirm", "GET", { "sec-fetch-site": "none", "sec-fetch-mode": "navigate", accept: "text/html" });
    expect(page.headers.get("content-type")).toContain("text/html");
  });
  it("refuses before any call to Supabase", async () => {
    const sent = vi.fn();
    vi.stubGlobal("fetch", sent);
    await send("/auth/login", "POST", { "sec-fetch-site": "cross-site" });
    expect(sent).not.toHaveBeenCalled();
  });
});

describe("middleware: the existing rules are unchanged", () => {
  it("/api still accepts a POST with no origin headers, and still refuses a cross-site one", async () => {
    expect(passed(await send("/api/ai/chat", "POST", {}))).toBe(true);
    expect((await send("/api/ai/chat", "POST", { "sec-fetch-site": "cross-site" })).status).toBe(403);
  });
  it("paths that only look like /auth are not checked as /auth", async () => {
    expect(passed(await send("/authors", "POST", {}))).toBe(true);
  });
});
