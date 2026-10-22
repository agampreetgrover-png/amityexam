import { ApiError as GeminiApiError, GoogleGenAI, ThinkingLevel, type Content } from "@google/genai";
import Groq from "groq-sdk";

// Server-only AI providers. Gemini is tried first (bigger limits, reads PDFs/images);
// Groq is the automatic fallback when Gemini is rate-limited, down or misconfigured.

export type Msg = { role: "system" | "user" | "assistant"; content: string };
export type ProviderName = "gemini" | "groq";
type CallOpts = { fast?: boolean; kind?: "json" | "text" | "chat" };

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
  let out = s.replace(/AIza[\w-]{20,}|gsk_\w{20,}|AQ\.[\w-]{20,}/g, "[redacted]");
  for (const k of [process.env.GEMINI_API_KEY, process.env.GROQ_API_KEY]) if (k) out = out.split(k).join("[redacted]");
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
  const config = (system: string | undefined, json: boolean) => ({
    systemInstruction: system,
    temperature: 0.4,
    thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    ...(json ? { responseMimeType: "application/json" } : {}),
  });

  return {
    name: "gemini",
    maxContextChars: 200_000,
    chatHistory: 10,
    async json(messages, opts) {
      const { system, contents } = toGemini(messages);
      try {
        const res = await ai.models.generateContent({ model: model(opts?.fast), contents, config: config(system, true) });
        return res.text ?? "{}";
      } catch (e) {
        throw geminiError(e);
      }
    },
    async *stream(messages, opts) {
      const { system, contents } = toGemini(messages);
      let stream: AsyncGenerator<{ text?: string }>;
      try {
        stream = await ai.models.generateContentStream({ model: model(opts?.fast), contents, config: config(system, false) });
      } catch (e) {
        throw geminiError(e);
      }
      try {
        for await (const chunk of stream) if (chunk.text) yield chunk.text;
      } catch (e) {
        throw geminiError(e);
      }
    },
    async extract(file, prompt, opts) {
      try {
        const res = await ai.models.generateContent({
          model: model(opts?.fast),
          contents: [{ role: "user", parts: [{ inlineData: { mimeType: file.mimeType, data: file.data } }, { text: prompt }] }],
          config: { temperature: 0.1, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
        });
        return res.text ?? "";
      } catch (e) {
        throw geminiError(e);
      }
    },
  };
}

// ---------- Groq ----------

function groqError(e: unknown): AiProviderError {
  if (e instanceof Groq.APIError) {
    const msg = e.message ?? "";
    const status = e.status ?? 500;
    const retry = Number(e.headers?.["retry-after"] ?? 0) || undefined;
    if (status === 429) {
      const daily = /per day|\(RPD\)|\(TPD\)/i.test(msg);
      return new AiProviderError(msg, 429, daily ? "day" : "minute", daily ? undefined : retry, "groq");
    }
    if (status === 401 || status === 403) return new AiProviderError(msg, status, "auth", undefined, "groq");
    if (status === 404) return new AiProviderError(msg, 404, "config", undefined, "groq");
    if (status === 413) return new AiProviderError(msg, 413, "too-large", undefined, "groq");
    if (status >= 500) return new AiProviderError(msg, status, "unavailable", undefined, "groq");
    return new AiProviderError(msg, status, "other", undefined, "groq");
  }
  return networkError(e, "groq");
}

function groq(apiKey: string): Provider {
  const client = new Groq({ apiKey, maxRetries: 1, timeout: TIMEOUT_MS });
  const model = (fast?: boolean) =>
    fast ? (process.env.GROQ_FAST_MODEL ?? "openai/gpt-oss-20b") : (process.env.GROQ_MODEL ?? "openai/gpt-oss-120b");
  // Free tier is 8K tokens/min and Groq counts requested output against it, so keep caps small.
  const maxOut = (kind?: CallOpts["kind"]) => (kind === "json" ? 3000 : kind === "chat" ? 1500 : 2500);

  return {
    name: "groq",
    maxContextChars: 12_000,
    chatHistory: 6,
    async json(messages, opts) {
      try {
        const res = await client.chat.completions.create({
          model: model(opts?.fast),
          messages,
          response_format: { type: "json_object" },
          temperature: 0.3,
          max_completion_tokens: maxOut("json"),
          reasoning_effort: "low",
          include_reasoning: false,
        });
        return res.choices[0]?.message?.content ?? "{}";
      } catch (e) {
        throw groqError(e);
      }
    },
    async *stream(messages, opts) {
      let stream;
      try {
        stream = await client.chat.completions.create({
          model: model(opts?.fast),
          messages,
          temperature: opts?.kind === "chat" ? 0.5 : 0.3,
          max_completion_tokens: maxOut(opts?.kind),
          reasoning_effort: "low",
          include_reasoning: false,
          stream: true,
        });
      } catch (e) {
        throw groqError(e);
      }
      try {
        for await (const chunk of stream) {
          const t = chunk.choices[0]?.delta?.content;
          if (t) yield t;
        }
      } catch (e) {
        throw groqError(e);
      }
    },
  };
}

// ---------- Selection & fallback ----------

/** Configured providers in priority order. */
export function getProviders(): Provider[] {
  const out: Provider[] = [];
  if (process.env.GEMINI_API_KEY) out.push(gemini(process.env.GEMINI_API_KEY));
  if (process.env.GROQ_API_KEY) out.push(groq(process.env.GROQ_API_KEY));
  return out;
}

export const providerStatus = () => ({ gemini: !!process.env.GEMINI_API_KEY, groq: !!process.env.GROQ_API_KEY });

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

/** Pick the most useful error to show when every provider failed. */
function summarise(errors: AiProviderError[]): AiProviderError {
  if (errors.length === 1) return errors[0];
  if (errors.every((e) => e.kind === "day")) return errors[errors.length - 1];
  // A per-minute limit with a countdown is more actionable than an outage.
  const minute = errors.find((e) => e.kind === "minute");
  if (minute && errors.every((e) => e.kind === "minute" || e.kind === "day")) return minute;
  return errors.find((e) => e.kind === "too-large") ?? errors[errors.length - 1];
}
