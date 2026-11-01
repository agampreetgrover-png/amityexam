import { describe, expect, it } from "vitest";
import { neverCache } from "./sw-rules";

const req = (href: string, sameOrigin = true) => ({ url: new URL(href), sameOrigin });

describe("service worker never-cache rule", () => {
  it("never caches other sites (Supabase, Turnstile, AI providers)", () => {
    expect(neverCache(req("https://abc.supabase.co/auth/v1/user", false))).toBe(true);
    expect(neverCache(req("https://challenges.cloudflare.com/turnstile/v0/api.js", false))).toBe(true);
    expect(neverCache(req("https://openrouter.ai/api/v1/models", false))).toBe(true);
  });
  it("never caches the API, the auth routes or the sign-in pages", () => {
    for (const p of ["/api/ai/chat", "/auth/session", "/auth/confirm?token_hash=x", "/login", "/signup", "/check-email", "/forgot-password", "/reset-password", "/switch"]) {
      expect(neverCache(req(`https://app.example${p}`)), p).toBe(true);
    }
  });
  it("leaves app pages and build assets to the normal caching (same for every visitor)", () => {
    for (const p of ["/", "/subjects", "/subjects/view?id=2", "/settings", "/~offline", "/_next/static/chunks/a.js", "/authors", "/loginx"]) {
      expect(neverCache(req(`https://app.example${p}`)), p).toBe(false);
    }
  });
});
