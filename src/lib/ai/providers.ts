import { ApiError as GeminiApiError, GoogleGenAI, ThinkingLevel, type Content } from "@google/genai";

// Server-only AI providers. OpenRouter is tried first for everything; Gemini is the automatic fallback when it's
// rate-limited, down or misconfigured.

export type Msg = { role: "system" | "user" | "assistant"; content: string };
export type ProviderName = "gemini" | "openrouter";
type CallOpts = { fast?: boolean; kind?: "json" | "text" | "chat" };

// Output caps (tokens) for OpenRouter and Gemini. Roomy enough for the longest real answers (a whole paper split
// into questions, a scan transcribed), but a model that runs away can't keep the server busy streaming and parsing
// megabytes. Gemini counts its thinking against the same cap.
const OUT_CAP = { json: 16_384, text: 8_192, chat: 4_096, extract: 16_384 } as const;
const outCap = (kind?: CallOpts["kind"]) => OUT_CAP[kind ?? "text"];

interface Provider {
  name: ProviderName;
  /** How much pasted material a prompt may include for this provider. */
  maxContextChars: number;
  /** How many past chat messages to send. */
  chatHistory: number;
  json(messages: Msg[], opts?: CallOpts): Promise<string>;
  stream(messages: Msg[], opts?: CallOpts): AsyncIterable<string>;
  extract?(file: { mimeType: string; data: string }, prompt: string, opts?: { fast?: boolean }): Promise<string>;
}

type ErrorKind = "minute" | "day" | "auth" | "too-large" | "config" | "unavailable" | "bad-output" | "other";

export class AiProviderError extends Error {
  constructor(
    message: string,
    public status: number,
    public kind: ErrorKind,
    public retryAfter?: number,
    public provider?: ProviderName,
  ) {
    super(message);
  }
  /** Worth trying the next provider? (limits, outages, timeouts, bad model config, bad key, malformed reply) */
  get fallThrough() {
    return this.kind !== "too-large" && this.kind !== "other";
  }
}

const TIMEOUT_MS = 90_000;

/** Strip API keys from text before it is logged. */
export function redact(s: string): string {
  let out = s.replace(/AIza[\w-]{20,}|gsk_\w{20,}|AQ\.[\w-]{20,}|sk-or-[\w-]{20,}/g, "[redacted]");
  for (const k of [process.env.GEMINI_API_KEY, process.env.OPENROUTER_API_KEY]) if (k) out = out.split(k).join("[redacted]");
  return out;
}

// ---------- Gemini ----------

function toGemini(messages: Msg[]) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents: Content[] = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  return { system: system || undefined, contents };
}

function geminiError(e: unknown): AiProviderError {
  if (e instanceof GeminiApiError) {
    const msg = e.message ?? "";
    const delay = /retryDelay"?\s*:\s*"?(\d+)/.exec(msg)?.[1] ?? /retry in ([\d.]+)s/i.exec(msg)?.[1];
    const retry = delay ? Math.ceil(Number(delay)) : undefined;
    if (e.status === 429) {
      const daily = /PerDay|per day|daily/i.test(msg);
      return new AiProviderError(msg, 429, daily ? "day" : "minute", daily ? undefined : retry, "gemini");
    }
    if (e.status === 401 || e.status === 403) return new AiProviderError(msg, e.status, "auth", undefined, "gemini");
    if (e.status === 404) return new AiProviderError(msg, 404, "config", undefined, "gemini");
    if (e.status === 413 || /exceeds the maximum number of tokens/i.test(msg)) return new AiProviderError(msg, 413, "too-large", undefined, "gemini");
    if (e.status === 400 && /API key/i.test(msg)) return new AiProviderError(msg, 401, "auth", undefined, "gemini");
    if (e.status >= 500) return new AiProviderError(msg, e.status, "unavailable", undefined, "gemini");
    return new AiProviderError(msg, e.status || 500, "other", undefined, "gemini");
  }
  return networkError(e, "gemini");
}

function networkError(e: unknown, provider: ProviderName) {
  const msg = e instanceof Error ? e.message : String(e);
  // Timeouts, DNS and connection resets: the provider is unreachable, so try the next one.
  return new AiProviderError(msg, 503, "unavailable", undefined, provider);
}

function gemini(apiKey: string): Provider {
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: TIMEOUT_MS } });
  const model = (fast?: boolean) =>
    fast ? (process.env.GEMINI_FAST_MODEL ?? "gemini-3.5-flash-lite") : (process.env.GEMINI_MODEL ?? "gemini-3.5-flash");
  const config = (system: string | undefined, kind: CallOpts["kind"]) => ({
    systemInstruction: system,
    temperature: 0.4,
    maxOutputTokens: outCap(kind),
    thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    ...(kind === "json" ? { responseMimeType: "application/json" } : {}),
  });

  return {
    name: "gemini",
    maxContextChars: 200_000,
    chatHistory: 10,
    async json(messages, opts) {
      const { system, contents } = toGemini(messages);
      try {
        const res = await ai.models.generateContent({ model: model(opts?.fast), contents, config: config(system, "json") });
        // No reply at all has to fail JSON parsing, so the next provider gets a turn; "{}" would pass as an empty answer.
        return res.text ?? "";
      } catch (e) {
        throw geminiError(e);
      }
    },
    async *stream(messages, opts) {
      const { system, contents } = toGemini(messages);
      let stream: AsyncGenerator<{ text?: string }>;
      // The client's timeout stays armed while the stream is read and would cut a long answer off,
      // so here it only covers waiting for the first words (not just the headers) to arrive.
      const ctrl = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        try {
          stream = await ai.models.generateContentStream({
            model: model(opts?.fast),
            contents,
            config: { ...config(system, opts?.kind === "chat" ? "chat" : "text"), httpOptions: { timeout: 0 }, abortSignal: ctrl.signal },
          });
        } catch (e) {
          throw geminiError(e);
        }
        try {
          for await (const chunk of stream) {
            if (!chunk.text) continue;
            clearTimeout(timer);
            timer = undefined;
            yield chunk.text;
          }
        } catch (e) {
          throw geminiError(e);
        }
      } finally {
        clearTimeout(timer);
      }
    },
    async extract(file, prompt, opts) {
      try {
        const res = await ai.models.generateContent({
          model: model(opts?.fast),
          contents: [{ role: "user", parts: [{ inlineData: { mimeType: file.mimeType, data: file.data } }, { text: prompt }] }],
          config: { temperature: 0.1, maxOutputTokens: OUT_CAP.extract, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
        });
        return res.text ?? "";
      } catch (e) {
        throw geminiError(e);
      }
    },
  };
}

// ---------- OpenRouter ----------

class OpenRouterHttpError extends Error {
  constructor(message: string, public status: number, public retryAfter?: number) {
    super(message);
  }
}

function openrouterError(e: unknown): AiProviderError {
  if (e instanceof AiProviderError) return e;
  if (e instanceof OpenRouterHttpError) {
    const { message: msg, status, retryAfter } = e;
    if (status === 429) {
      // Free models allow so many requests a day (50 without credits); the message names the daily limit.
      const daily = /per[- ]day|free-models-per-day/i.test(msg);
      return new AiProviderError(msg, 429, daily ? "day" : "minute", daily ? undefined : retryAfter, "openrouter");
    }
    if (status === 402) return new AiProviderError(msg, 402, "day", undefined, "openrouter"); // out of credits
    if (status === 401 || status === 403) return new AiProviderError(msg, status, "auth", undefined, "openrouter");
    if (status === 404) return new AiProviderError(msg, 404, "config", undefined, "openrouter"); // model gone or no endpoint
    if (status === 413 || /context length|too many tokens/i.test(msg)) return new AiProviderError(msg, 413, "too-large", undefined, "openrouter");
    if (status === 408 || status >= 500) return new AiProviderError(msg, status, "unavailable", undefined, "openrouter");
    return new AiProviderError(msg, status, "other", undefined, "openrouter");
  }
  return networkError(e, "openrouter");
}

function openrouter(apiKey: string): Provider {
  // Free models (":free") cost nothing but are often busy or briefly gone, so each tier is a short list that
  // OpenRouter works through in order. Their ids change over time: override with comma-separated lists in .env.local.
  const list = (env: string | undefined, fallback: string) => (env ?? fallback).split(",").map((m) => m.trim()).filter(Boolean);
  const model = (fast?: boolean) =>
    fast
      ? list(process.env.OPENROUTER_FAST_MODEL, "nvidia/nemotron-3.5-lightning:free,recursive/flint-v1.0:free,poolside/laguna-s-2.1:free")
      : list(process.env.OPENROUTER_MODEL, "nvidia/nemotron-3.5-super-vl:free,nvidia/nemotron-3-ultra-550b-a55b:free,dots-studio/dots-3-note-preview:free");
  // Photos need models that take images; not every text model above does.
  const visionModels = () =>
    list(process.env.OPENROUTER_VISION_MODEL, "nvidia/nemotron-3.5-super-vl:free,dots-studio/dots-3-note-preview:free,google/gemma-4-31b-it:free");
  const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

  // `signal`: a stream brings its own, since its timeout lasts until the first words rather than the whole answer.
  async function call(body: Record<string, unknown>, signal?: AbortSignal) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "X-Title": "Amity Exams" },
      body: JSON.stringify({ ...body, reasoning: { effort: "low", exclude: true } }),
      signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let msg = text;
      try {
        msg = JSON.parse(text)?.error?.message ?? text;
      } catch {
        // not JSON; keep the raw text
      }
      throw new OpenRouterHttpError(msg || res.statusText, res.status, Number(res.headers.get("retry-after")) || undefined);
    }
    return res;
  }

  async function complete(body: Record<string, unknown>): Promise<string | undefined> {
    const data = await (await call(body)).json();
    // OpenRouter can answer 200 with an error from the upstream model.
    if (data.error) throw new OpenRouterHttpError(data.error.message ?? "upstream error", Number(data.error.code) || 502);
    return data.choices?.[0]?.message?.content;
  }

  return {
    name: "openrouter",
    maxContextChars: 200_000, // the free models take 256K+ tokens; same material as Gemini gets
    chatHistory: 10,
    async json(messages, opts) {
      try {
        return (await complete({ models: model(opts?.fast), messages, response_format: { type: "json_object" }, temperature: 0.3, max_tokens: OUT_CAP.json })) ?? "";
      } catch (e) {
        throw openrouterError(e);
      }
    },
    async extract(file, prompt, opts) {
      const pdf = file.mimeType === "application/pdf";
      // HEIC and the like: let Gemini read those.
      if (!pdf && !IMAGE_TYPES.has(file.mimeType)) throw new AiProviderError(`can't send ${file.mimeType}`, 415, "config", undefined, "openrouter");
      const url = `data:${file.mimeType};base64,${file.data}`;
      try {
        const text = await complete({
          // PDFs go through OpenRouter's OCR parser (free) before the model sees them, so any text model will do.
          models: pdf ? model(opts?.fast) : visionModels(),
          messages: [
            {
              role: "user",
              content: [
                pdf ? { type: "file", file: { filename: "scan.pdf", file_data: url } } : { type: "image_url", image_url: { url } },
                { type: "text", text: prompt },
              ],
            },
          ],
          ...(pdf ? { plugins: [{ id: "file-parser", pdf: { engine: "mistral-ocr" } }] } : {}),
          temperature: 0.1,
          max_tokens: OUT_CAP.extract,
        });
        return text ?? "";
      } catch (e) {
        const err = openrouterError(e);
        // A file OpenRouter refuses may still be readable by Gemini.
        if (err.kind === "other") err.kind = "config";
        throw err;
      }
    },
    async *stream(messages, opts) {
      // The timeout covers waiting for the first words, not just the headers: with every free model busy OpenRouter
      // answers 200 and then only sends keep-alives, which would hold the answer (and the move to Gemini) up for good.
      // Once text flows it's off, since a long answer may take longer than that to arrive.
      const ctrl = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => ctrl.abort(new Error("no answer in time")), TIMEOUT_MS);
      let res: Response;
      try {
        res = await call({ models: model(opts?.fast), messages, temperature: opts?.kind === "chat" ? 0.5 : 0.3, max_tokens: outCap(opts?.kind), stream: true }, ctrl.signal);
      } catch (e) {
        clearTimeout(timer);
        throw openrouterError(e);
      }
      const reader = res.body!.getReader();
      try {
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            // Server-sent events: "data: {...}" lines, ": OPENROUTER PROCESSING" keep-alives, "data: [DONE]" at the end.
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") return;
            let chunk;
            try {
              chunk = JSON.parse(payload);
            } catch {
              continue;
            }
            if (chunk.error) throw new OpenRouterHttpError(chunk.error.message ?? "upstream error", Number(chunk.error.code) || 502);
            const t = chunk.choices?.[0]?.delta?.content;
            if (t) {
              clearTimeout(timer);
              timer = undefined;
              yield t;
            }
          }
        }
      } catch (e) {
        throw openrouterError(e);
      } finally {
        clearTimeout(timer);
        // Also runs when the reader stops early (the student hit stop), so the upstream request ends with it.
        reader.cancel().catch(() => {});
      }
    },
  };
}

// ---------- Selection & fallback ----------

/** Configured providers in priority order. */
export function getProviders(): Provider[] {
  const out: Provider[] = [];
  if (process.env.OPENROUTER_API_KEY) out.push(openrouter(process.env.OPENROUTER_API_KEY));
  if (process.env.GEMINI_API_KEY) out.push(gemini(process.env.GEMINI_API_KEY));
  return out;
}

export const providerStatus = () => ({
  gemini: !!process.env.GEMINI_API_KEY,
  openrouter: !!process.env.OPENROUTER_API_KEY,
});

/**
 * Run fn on each provider in order until one succeeds. Falls through on
 * limits, outages, timeouts, bad keys and missing models; stops on errors
 * the next provider would hit too (e.g. input too large).
 */
export async function runWithFallback<T>(
  fn: (p: Provider) => Promise<T>,
  providers = getProviders(),
): Promise<{ result: T; provider: ProviderName }> {
  if (!providers.length) throw new AiProviderError("No AI key set", 500, "config");
  const errors: AiProviderError[] = [];
  for (const p of providers) {
    try {
      return { result: await fn(p), provider: p.name };
    } catch (e) {
      const err = e instanceof AiProviderError ? e : new AiProviderError(e instanceof Error ? e.message : String(e), 500, "other", undefined, p.name);
      console.warn(`[ai] ${p.name} failed (${err.kind} ${err.status}): ${redact(err.message).slice(0, 200)}`);
      errors.push(err);
      if (!err.fallThrough) break;
    }
  }
  throw summarise(errors);
}

/**
 * Scans and photos → text with each provider that can read files (OpenRouter, then Gemini).
 * `fast` picks which Gemini model goes first; the lite and main models have separate quotas,
 * so when one is limited the other stands in before moving on.
 */
export function extractWithFallback(file: { mimeType: string; data: string }, prompt: string, fast = false) {
  return runWithFallback(
    async (p) => {
      try {
        return await p.extract!(file, prompt, { fast });
      } catch (e) {
        if (p.name !== "gemini" || !(e instanceof AiProviderError) || (e.kind !== "day" && e.kind !== "minute")) throw e;
        return await p.extract!(file, prompt, { fast: !fast });
      }
    },
    getProviders().filter((p) => p.extract),
  );
}

/** Pick the most useful error to show when every provider failed. */
function summarise(errors: AiProviderError[]): AiProviderError {
  if (errors.length === 1) return errors[0];
  if (errors.every((e) => e.kind === "day")) return errors[errors.length - 1];
  // A per-minute limit with a countdown is more actionable than an outage.
  const minute = errors.find((e) => e.kind === "minute");
  if (minute && errors.every((e) => e.kind === "minute" || e.kind === "day")) return minute;
  // A rejected key won't fix itself overnight, so it beats the other provider's limit or outage.
  return errors.find((e) => e.kind === "too-large") ?? errors.find((e) => e.kind === "auth") ?? errors[errors.length - 1];
}
