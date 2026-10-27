import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProviders } from "./providers";

const msgs = [{ role: "user" as const, content: "hi" }];
const openrouter = () => getProviders().find((p) => p.name === "openrouter")!;

beforeEach(() => vi.stubEnv("OPENROUTER_API_KEY", "test-key"));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("OpenRouter", () => {
  it("returns no JSON for an empty reply, so it fails parsing and the next provider is tried", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ choices: [{ message: { content: null } }] }));
    const raw = await openrouter().json(msgs);
    expect(() => JSON.parse(raw)).toThrow();
  });

  it("doesn't time out a stream that is still arriving after the request timeout", async () => {
    vi.useFakeTimers();
    // AbortSignal.timeout runs on Node's own clock; put it on the fake one too.
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const c = new AbortController();
      setTimeout(() => c.abort(), ms);
      return c.signal;
    });
    let signal: AbortSignal | undefined;
    let push!: (s: string) => void;
    let end!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        push = (s) => c.enqueue(new TextEncoder().encode(s));
        end = () => c.close();
      },
    });
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Response(body);
    });
    const it = openrouter().stream(msgs)[Symbol.asyncIterator]();
    push('data: {"choices":[{"delta":{"content":"a"}}]}\n');
    expect(await it.next()).toEqual({ done: false, value: "a" });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(signal?.aborted).toBe(false);
    push('data: {"choices":[{"delta":{"content":"b"}}]}\ndata: [DONE]\n');
    end();
    expect(await it.next()).toEqual({ done: false, value: "b" });
  });
});
