import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setStoreForTests } from "@/lib/ratelimit";
import { get, post, setupAccounts, teardownAccounts, type Harness } from "@/test/auth-routes";
import { POST as forgot } from "./forgot/route";
import { POST as login } from "./login/route";
import { POST as resend } from "./resend/route";
import { GET as session } from "./session/route";
import { POST as signout } from "./signout/route";
import { POST as signup } from "./signup/route";
import { POST as updatePassword } from "./update-password/route";
import { POST as verify } from "./verify/route";

vi.mock("@/lib/supabase/projects", () => ({ SUPABASE_PROJECTS: { development: ["devrefaaaaaaaaaaaaaa"], production: [], local: [] } }));

// What every POST /auth/* route does before anything else, checked route by route with a valid body for each, so a
// refusal can only come from the shared checks. These call the handlers directly: the middleware is not in front.

type Handler = (req: NextRequest) => Promise<Response>;
const GOOD = "correct horse battery";
const ROUTES: [string, Handler, object][] = [
  ["/auth/login", login, { email: "a@example.test", password: GOOD }],
  ["/auth/signup", signup, { email: "a@example.test", password: GOOD }],
  ["/auth/resend", resend, { email: "a@example.test" }],
  ["/auth/forgot", forgot, { email: "a@example.test" }],
  ["/auth/verify", verify, { tokenHash: "a".repeat(56), type: "signup" }],
  ["/auth/update-password", updatePassword, { password: GOOD, expectedUserId: "u" }],
  ["/auth/signout", signout, {}],
];

let h: Harness;
beforeEach(() => (h = setupAccounts()));
afterEach(teardownAccounts);

describe.each(ROUTES)("POST %s: the shared checks", (path, handler, body) => {
  it("a cross-site request → 403 blocked, and Supabase and the rate limits are never reached", async () => {
    for (const headers of [
      { "sec-fetch-site": "cross-site", origin: "https://evil.example" },
      { "sec-fetch-site": "same-site", origin: "https://other.127.0.0.1:3000" },
      { "sec-fetch-site": "same-origin", origin: "https://evil.example" },
      { "sec-fetch-site": "none", origin: "null" },
    ]) {
      const res = await handler(post(path, body, { headers }));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: { code: "blocked" } });
    }
    expect(h.server.calls).toHaveLength(0);
    expect(h.store.checks).toHaveLength(0);
  });
  it("no Origin and no Sec-Fetch-Site at all → 403", async () => {
    const req = post(path, body);
    req.headers.delete("origin");
    req.headers.delete("sec-fetch-site");
    expect((await handler(req)).status).toBe(403);
  });
  it("not JSON → 415 invalid_input", async () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const res = await handler(post(path, body, { headers: { "content-type": type } }));
      expect(res.status).toBe(415);
      expect(await res.json()).toEqual({ error: { code: "invalid_input" } });
    }
    expect(h.server.calls).toHaveLength(0);
  });
  it("accounts off → 404 disabled (after the same-origin check), nothing reached", async () => {
    teardownAccounts();
    h = setupAccounts({ enabled: false });
    const res = await handler(post(path, body));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "disabled" } });
    expect((await handler(post(path, body, { headers: { "sec-fetch-site": "cross-site" } }))).status).toBe(403);
    expect(h.server.calls).toHaveLength(0);
    expect(h.store.checks).toHaveLength(0);
  });
  it("a malformed, non-object or oversized body → 400/413 invalid_input", async () => {
    for (const [raw, status] of [["{not json", 400], ["[]", 400], ["null", 400], ['"x"', 400], ["", 400], [JSON.stringify({ pad: "x".repeat(9000) }), 413]] as const) {
      const res = await handler(post(path, null, { raw }));
      expect(res.status).toBe(status);
      expect((await res.json()).error.code).toBe("invalid_input");
    }
    expect(h.server.calls).toHaveLength(0);
  });
  it("every answer is JSON and never cached", async () => {
    const res = await handler(post(path, body));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

describe.each(ROUTES.filter(([p]) => p !== "/auth/signout"))("POST %s: rate-limit store", (path, handler, body) => {
  it("a store that can't answer → 503 unavailable, and Supabase is never asked (fail closed)", async () => {
    setStoreForTests(null);
    const res = await handler(post(path, body));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { code: "unavailable" } });
    expect(h.server.calls).toHaveLength(0);
  });
  it("a store that throws → 503 unavailable", async () => {
    setStoreForTests({ limit: async () => Promise.reject(new Error("redis down")) });
    expect((await handler(post(path, body))).status).toBe(503);
    expect(h.server.calls).toHaveLength(0);
  });
});

describe("GET /auth/session: shared behaviour", () => {
  it("accounts off → 200 { state: disabled }", async () => {
    teardownAccounts();
    h = setupAccounts({ enabled: false });
    const res = await session(get("/auth/session"));
    expect(await res.json()).toEqual({ state: "disabled" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

// A new /auth/* route must go through the shared checks: this fails if one doesn't.
describe("every /auth/* route handler", () => {
  const dir = join(process.cwd(), "src", "app", "auth");
  const routes = readdirSync(dir)
    .filter((d) => statSync(join(dir, d)).isDirectory())
    .map((d) => [d, readFileSync(join(dir, d, "route.ts"), "utf8")] as const);

  it("is one of the eight known routes", () => {
    expect(routes.map(([d]) => d).sort()).toEqual(["forgot", "login", "resend", "session", "signout", "signup", "update-password", "verify"]);
  });
  for (const [name, src] of routes) {
    it(`${name}: a POST goes through authPost (authRequestRefusal first), and no other method is exported`, () => {
      const methods = [...src.matchAll(/export (?:const|async function) (GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g)].map((m) => m[1]);
      if (name === "session") expect(methods).toEqual(["GET"]);
      else {
        expect(methods).toEqual(["POST"]);
        expect(src).toMatch(/export const POST = (authPost|emailOnlyRoute)\(/);
      }
      expect(src).not.toMatch(/createServerClient|createSupabaseServerClient|buildServerClient/); // only the shared clients
    });
  }
});
