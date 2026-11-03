import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE, forgedAccessToken, sessionBody, signedInCookies, USER_ID } from "@/test/fake-supabase";
import { isDeletion, post, sessionIn, setCookies, setupAccounts, teardownAccounts, type Harness } from "@/test/auth-routes";
import { POST as verify } from "./verify/route";

vi.mock("@/lib/supabase/projects", () => ({ SUPABASE_PROJECTS: { development: ["devrefaaaaaaaaaaaaaa"], production: [], local: [] } }));

// M3: someone can send a student a valid link for THEIR OWN account. Opening it must never silently replace the
// account this browser is signed in to: while a session is present, the link is only used with replaceSession: true
// (sent by the confirm screen after the student pressed "Sign out and continue" on a screen naming that account).

const HASH = "0123456789abcdef".repeat(4);
const OTHER_USER = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const now = () => Math.floor(Date.now() / 1000);

let h: Harness;
beforeEach(() => (h = setupAccounts()));
afterEach(teardownAccounts);

const open = async (body: object, cookies: { name: string; value: string }[] = []) => {
  const res = await verify(post("/auth/verify", body, { cookies }));
  return { res, status: res.status, body: await res.json(), cookies: setCookies(res) };
};

describe("an emailed link never silently replaces a signed-in account", () => {
  for (const type of ["signup", "email", "recovery"] as const) {
    it(`a ${type} link while signed in, without replaceSession → 409 switch_required; the link isn't used, nothing changes`, async () => {
      const r = await open({ tokenHash: HASH, type }, await signedInCookies(3600));
      expect(r.status).toBe(409);
      expect(r.body).toEqual({ error: { code: "switch_required" } });
      expect(h.server.calls).toHaveLength(0); // Supabase never asked: the link still works afterwards
      expect(h.store.checks).toHaveLength(0); // and no limit was spent on the question
      expect(r.cookies.size).toBe(0); // the signed-in account's cookies are untouched
    });
  }

  it("replaceSession must be exactly true: false, a string or a number is not consent", async () => {
    const cookies = await signedInCookies(3600);
    expect((await open({ tokenHash: HASH, type: "signup", replaceSession: false }, cookies)).status).toBe(409);
    expect((await open({ tokenHash: HASH, type: "signup", replaceSession: "true" }, cookies)).body).toEqual({ error: { code: "invalid_input" } });
    expect((await open({ tokenHash: HASH, type: "signup", replaceSession: 1 }, cookies)).body).toEqual({ error: { code: "invalid_input" } });
    expect(h.server.calls).toHaveLength(0);
  });

  it("a chunked session counts as signed in too (only .0/.1… cookies)", async () => {
    const big = await signedInCookies(3600, "x".repeat(5000));
    expect(big.some((c) => c.name === `${COOKIE}.0`)).toBe(true);
    expect((await open({ tokenHash: HASH, type: "signup" }, big)).status).toBe(409);
  });

  it("nobody signed in (or only a PKCE verifier / unrelated cookies): the link is used directly", async () => {
    h.server.reply("verify", { status: 200, body: sessionBody(3600) }, { status: 200, body: sessionBody(3600) });
    expect((await open({ tokenHash: HASH, type: "signup" })).status).toBe(200);
    expect((await open({ tokenHash: HASH, type: "signup" }, [{ name: `${COOKIE}-code-verifier`, value: "v" }, { name: "theme", value: "dark" }])).status).toBe(200);
  });
});

describe("after the student confirmed the switch (replaceSession: true)", () => {
  it("the link's session replaces the old one, and the old session is revoked at Supabase with its own token, this session only", async () => {
    const old = await signedInCookies(3600);
    expect(old).toHaveLength(1); // one cookie, "base64-" + the session as base64url JSON
    const oldToken = JSON.parse(Buffer.from(old[0].value.slice("base64-".length), "base64url").toString("utf8")).access_token;
    const linked = sessionBody(3600, "", { session_id: "linked-session" }, OTHER_USER);
    h.server.reply("verify", { status: 200, body: linked });
    h.server.reply("logout", { status: 200, body: {} });
    const r = await open({ tokenHash: HASH, type: "signup", replaceSession: true }, old);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ userId: OTHER_USER, type: "signup" });
    expect((await sessionIn(r.res))?.refresh_token).toBe(linked.refresh_token);
    const logout = h.server.calls.find((c) => c.endpoint === "logout")!;
    expect(new URL(logout.url).searchParams.get("scope")).toBe("local");
    expect(logout.bearer).toBe(oldToken);
    expect(h.server.calls.map((c) => c.endpoint)).toEqual(["verify", "logout"]); // no refresh of the old session
  });

  it("an old session whose access token already expired is not refreshed just to revoke it: replaced only", async () => {
    h.server.reply("verify", { status: 200, body: sessionBody(3600, "", {}, OTHER_USER) });
    const r = await open({ tokenHash: HASH, type: "recovery", replaceSession: true }, await signedInCookies(-10));
    expect(r.status).toBe(200);
    expect(h.server.calls.map((c) => c.endpoint)).toEqual(["verify"]);
  });

  it("revoking the old session failing never undoes the link (best effort)", async () => {
    h.server.reply("verify", { status: 200, body: sessionBody(3600, "", {}, OTHER_USER) });
    h.server.reply("logout", "network");
    const r = await open({ tokenHash: HASH, type: "signup", replaceSession: true }, await signedInCookies(3600));
    expect(r.status).toBe(200);
    expect(await sessionIn(r.res)).not.toBeNull();
  });

  it("a forged old session isn't sent to Supabase to be revoked (it was never Supabase's)", async () => {
    const b64 = (o: unknown) => "base64-" + Buffer.from(JSON.stringify(o)).toString("base64url");
    const forged = [{ name: COOKIE, value: b64({ access_token: forgedAccessToken(now() + 3600), refresh_token: "x", expires_at: now() + 3600, token_type: "bearer", user: { id: USER_ID } }) }];
    h.server.reply("verify", { status: 200, body: sessionBody(3600) });
    const r = await open({ tokenHash: HASH, type: "signup", replaceSession: true }, forged);
    expect(r.status).toBe(200);
    expect(h.server.calls.map((c) => c.endpoint)).toEqual(["verify"]);
    expect(isDeletion(r.cookies.get(COOKIE))).toBe(false);
  });

  it("a link that fails leaves the old session exactly as it was, and revokes nothing", async () => {
    h.server.reply("verify", { status: 403, body: { code: "otp_expired" } });
    const r = await open({ tokenHash: HASH, type: "signup", replaceSession: true }, await signedInCookies(3600));
    expect(r.body).toEqual({ error: { code: "link_expired" } });
    expect(r.cookies.size).toBe(0);
    expect(h.server.calls.map((c) => c.endpoint)).toEqual(["verify"]);
  });
});
