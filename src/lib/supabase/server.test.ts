import { afterEach, describe, expect, it, vi } from "vitest";
import { resetAccountsConfigForTests } from "./env";
import { createSupabaseServerClient, secureCookieOptions, timedFetch } from "./server";

afterEach(() => {
  vi.unstubAllEnvs();
  resetAccountsConfigForTests();
});

describe("Supabase cookie flags", () => {
  it("forces HttpOnly, SameSite=Lax, Path=/ and Secure on https, whatever Supabase asks for", () => {
    const o = secureCookieOptions({ httpOnly: false, sameSite: "none", path: "/x", secure: false, maxAge: 400 }, true);
    expect(o).toEqual({ httpOnly: true, sameSite: "lax", path: "/", secure: true, maxAge: 400 });
  });
  it("keeps Supabase's expiry, so deleting a cookie (maxAge 0) still deletes it", () => {
    expect(secureCookieOptions({ maxAge: 0 }, true).maxAge).toBe(0);
  });
  it("can't be Secure over plain http (a laptop copy), but is still HttpOnly", () => {
    expect(secureCookieOptions({}, false)).toMatchObject({ httpOnly: true, secure: false, sameSite: "lax" });
  });
});

describe("createSupabaseServerClient", () => {
  it("returns no client while accounts are off", () => {
    vi.stubEnv("SUPABASE_URL", "");
    expect(createSupabaseServerClient({ getAll: () => [], set: () => {} }, { https: true })).toBeNull();
  });
});

describe("timedFetch (every Supabase call has a time limit)", () => {
  it("aborts a call that doesn't answer in time", async () => {
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))));
    try {
      await expect(timedFetch(50)("https://devref.supabase.co/auth/v1/user")).rejects.toMatchObject({ name: "TimeoutError" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("after a shared deadline, sends nothing and answers 408 (which Supabase's client won't retry)", async () => {
    const sent = vi.fn();
    vi.stubGlobal("fetch", sent);
    try {
      const deadline = AbortSignal.abort();
      const res = await timedFetch(10_000, deadline)("https://devref.supabase.co/auth/v1/token?grant_type=refresh_token");
      expect(res.status).toBe(408);
      expect(sent).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("cuts off a call in flight when the shared deadline passes", async () => {
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))));
    try {
      await expect(timedFetch(10_000, AbortSignal.timeout(50))("https://devref.supabase.co/auth/v1/user")).rejects.toMatchObject({ name: "TimeoutError" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("still honours the caller's own abort signal", async () => {
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))));
    try {
      const c = new AbortController();
      const p = timedFetch(10_000)("https://devref.supabase.co/auth/v1/user", { signal: c.signal });
      c.abort(new Error("cancelled"));
      await expect(p).rejects.toThrow("cancelled");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

