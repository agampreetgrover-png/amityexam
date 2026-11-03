import { afterEach, describe, expect, it, vi } from "vitest";
import { requestHostname, SITEVERIFY_URL, verifyCaptcha } from "./captcha";

// H1: this server checks every Turnstile token itself. Anything but a clear "yes" for this form on this site is a
// refusal, and anything that isn't an answer from Cloudflare fails closed ("unavailable"), never open.

const SECRET = "0x4AAAAAAAreal-looking-secret";
const answer = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
const check = (over: Partial<Parameters<typeof verifyCaptcha>[0]> = {}) => verifyCaptcha({ secret: SECRET, token: "tok", action: "login", hostname: "app.example", ...over });

afterEach(() => vi.unstubAllGlobals());

describe("verifyCaptcha", () => {
  it("ok only for success, this action and this host; sends the secret and token to siteverify", async () => {
    const f = answer({ success: true, action: "login", hostname: "app.example" });
    vi.stubGlobal("fetch", f);
    expect(await check()).toBe("ok");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SITEVERIFY_URL);
    expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({ secret: SECRET, response: "tok" });
  });

  it("host names compare without case", async () => {
    vi.stubGlobal("fetch", answer({ success: true, action: "login", hostname: "App.Example" }));
    expect(await check()).toBe("ok");
  });

  it("missing or over-long token: failed, without asking Cloudflare", async () => {
    const f = answer({ success: true });
    vi.stubGlobal("fetch", f);
    expect(await check({ token: "" })).toBe("failed");
    expect(await check({ token: "x".repeat(2049) })).toBe("failed");
    expect(f).not.toHaveBeenCalled();
  });

  it("refused by Cloudflare (bad, expired or reused token): failed", async () => {
    for (const codes of [["invalid-input-response"], ["timeout-or-duplicate"], []]) {
      vi.stubGlobal("fetch", answer({ success: false, "error-codes": codes }));
      expect(await check()).toBe("failed");
    }
  });

  it("a token made for another form, or on another site, is refused", async () => {
    vi.stubGlobal("fetch", answer({ success: true, action: "signup", hostname: "app.example" }));
    expect(await check()).toBe("failed");
    vi.stubGlobal("fetch", answer({ success: true, action: "login", hostname: "evil.example" }));
    expect(await check()).toBe("failed");
    vi.stubGlobal("fetch", answer({ success: true, action: "login" })); // no host name at all
    expect(await check()).toBe("failed");
  });

  it("fails closed: network error, timeout, 5xx, unreadable answer or Cloudflare's own internal error → unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect(await check()).toBe("unavailable");
    vi.stubGlobal("fetch", answer({}, 503));
    expect(await check()).toBe("unavailable");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    expect(await check()).toBe("unavailable");
    vi.stubGlobal("fetch", answer({ success: false, "error-codes": ["internal-error"] }));
    expect(await check()).toBe("unavailable");
    vi.stubGlobal("fetch", answer(null));
    expect(await check()).toBe("unavailable");
  });

  it("gives up at the request's deadline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true }))),
    );
    const started = Date.now();
    expect(await check({ deadline: AbortSignal.timeout(50) })).toBe("unavailable");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("Cloudflare's test secret skips the action and host checks (it answers for any site); Production refuses it in env.ts", async () => {
    vi.stubGlobal("fetch", answer({ success: true, hostname: "example.com", action: "" }));
    expect(await check({ secret: "1x0000000000000000000000000000000AA" })).toBe("ok");
    vi.stubGlobal("fetch", answer({ success: false, "error-codes": ["invalid-input-response"] }));
    expect(await check({ secret: "2x0000000000000000000000000000000AA" })).toBe("failed");
  });
});

describe("requestHostname", () => {
  it("drops the port, keeps the name, unwraps IPv6", () => {
    expect(requestHostname("127.0.0.1:3000")).toBe("127.0.0.1");
    expect(requestHostname("App.Example")).toBe("app.example");
    expect(requestHostname("[::1]:3000")).toBe("::1");
    expect(requestHostname("")).toBe("");
  });
});
