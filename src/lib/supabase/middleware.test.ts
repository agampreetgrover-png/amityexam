import { createServerClient } from "@supabase/ssr";
import { describe, expect, it } from "vitest";
import { sessionCookieName, sessionExpiresAt } from "./middleware";

// The middleware reads a session cookie's expiry to decide whether a refresh is worth asking Supabase for. These
// cookies are written by the real @supabase/ssr library (with a fake Supabase answering the sign-in), so a change to
// the library's cookie format shows up here instead of as students being silently signed out.

const EXPIRES_AT = 1_900_000_000;
const KEY = sessionCookieName("https://devref.supabase.co");

async function cookiesFromRealSignIn(userMetadata: Record<string, string> = {}) {
  const jar = new Map<string, string>();
  const supabase = createServerClient("https://devref.supabase.co", "sb_publishable_test", {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
    global: {
      fetch: async () =>
        new Response(
          JSON.stringify({
            access_token: "header.payload.signature",
            refresh_token: "refresh-token-value",
            token_type: "bearer",
            expires_in: 3600,
            expires_at: EXPIRES_AT,
            user: { id: "0f8fad5b-d9cb-469f-a165-70867728950e", aud: "authenticated", role: "authenticated", email: "a@example.test", user_metadata: userMetadata, app_metadata: {} },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email: "a@example.test", password: "correct horse" });
  expect(error).toBeNull();
  return [...jar].map(([name, value]) => ({ name, value }));
}

describe("sessionExpiresAt", () => {
  it("reads the expiry from a session cookie written by @supabase/ssr", async () => {
    const cookies = await cookiesFromRealSignIn();
    expect(cookies.some((c) => /^sb-devref-auth-token/.test(c.name))).toBe(true);
    expect(await sessionExpiresAt(cookies, KEY)).toBe(EXPIRES_AT);
  });

  it("reads it from a session large enough to be split into chunks (.0, .1, …)", async () => {
    const cookies = await cookiesFromRealSignIn({ bio: "x".repeat(6000) });
    expect(cookies.filter((c) => /^sb-devref-auth-token\.\d+$/.test(c.name)).length).toBeGreaterThan(1);
    expect(await sessionExpiresAt(cookies, KEY)).toBe(EXPIRES_AT);
  });

  it("finds nothing worth refreshing in a made-up or garbled cookie", async () => {
    const b64 = (v: string) => `base64-${Buffer.from(v).toString("base64url")}`;
    expect(await sessionExpiresAt([{ name: KEY, value: "anything" }], KEY)).toBeNull();
    expect(await sessionExpiresAt([{ name: KEY, value: "base64-!!!" }], KEY)).toBeNull();
    expect(await sessionExpiresAt([{ name: KEY, value: b64('{"expires_at":1}') }], KEY)).toBeNull(); // no refresh token
    expect(await sessionExpiresAt([{ name: KEY, value: b64("null") }], KEY)).toBeNull();
    expect(await sessionExpiresAt([{ name: KEY, value: b64("42") }], KEY)).toBeNull();
    expect(await sessionExpiresAt([{ name: "theme", value: "dark" }], KEY)).toBeNull();
    expect(await sessionExpiresAt([], KEY)).toBeNull();
  });

  it("reads only this project's cookie: another project's leftover cookie can't stand in for it or block it", async () => {
    const ours = await cookiesFromRealSignIn();
    const otherProject = { name: "sb-otherref-auth-token", value: `base64-${Buffer.from(JSON.stringify({ refresh_token: "x", expires_at: 1 })).toString("base64url")}` };
    expect(await sessionExpiresAt([otherProject, ...ours], KEY)).toBe(EXPIRES_AT);
    expect(await sessionExpiresAt([otherProject], KEY)).toBeNull();
  });
});

describe("sessionCookieName", () => {
  it("matches the name Supabase's client uses (first label of the Supabase host)", () => {
    expect(sessionCookieName("https://devref.supabase.co")).toBe("sb-devref-auth-token");
    expect(sessionCookieName("http://127.0.0.1:54321")).toBe("sb-127-auth-token");
  });
});
