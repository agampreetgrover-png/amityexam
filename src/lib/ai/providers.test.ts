import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiProviderError, getProviders, runWithFallback } from "./providers";

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

  it("sends photos in json as image parts to vision models, and plain text unchanged", async () => {
    const bodies: { models: string[]; messages: unknown[] }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return Response.json({ choices: [{ message: { content: "{}" } }] });
    });
    vi.stubEnv("OPENROUTER_VISION_MODEL", "vision/model");
    const img = "data:image/jpeg;base64,AAAA";
    await openrouter().json([{ role: "user", content: "read this", images: [img] }]);
    expect(bodies[0].models).toEqual(["vision/model"]);
    expect(bodies[0].messages).toEqual([
      { role: "user", content: [{ type: "text", text: "read this" }, { type: "image_url", image_url: { url: img } }] },
    ]);
    await openrouter().json(msgs);
    expect(bodies[1].models).not.toContain("vision/model");
    expect(bodies[1].messages).toEqual(msgs);
  });

  it("lets the next provider try after a 400 (unknown model id), in json and in a 200 body", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: { message: "x is not a valid model ID" } }, { status: 400 }));
    const err = await openrouter().json(msgs).catch((e) => e);
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.fallThrough).toBe(true);
    vi.stubGlobal("fetch", async () => Response.json({ error: { message: "Provider returned error", code: 400 } }));
    expect((await openrouter().json(msgs).catch((e) => e)).fallThrough).toBe(true);
  });
});

describe("runWithFallback", () => {
  type P = NonNullable<Parameters<typeof runWithFallback>[1]>[number];
  const failing = (name: "openrouter" | "gemini", kind: AiProviderError["kind"], status = 500) =>
    ({ name, json: async () => { throw new AiProviderError(`${name} ${kind}`, status, kind, undefined, name); } }) as unknown as P;
  const run = (ps: P[]) => runWithFallback((p) => p.json([]), ps).then(() => { throw new Error("expected a failure"); }, (e: AiProviderError) => e);

  it("doesn't report a daily limit on all providers when only the last one hit it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = await run([failing("openrouter", "bad-output", 502), failing("gemini", "day", 429)]);
    expect(err.kind).toBe("bad-output");
    expect(err.provider).toBe("openrouter");
  });

  it("still reports a daily limit when every provider hit one", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = await run([failing("openrouter", "day", 429), failing("gemini", "day", 429)]);
    expect(err.kind).toBe("day");
  });
});
