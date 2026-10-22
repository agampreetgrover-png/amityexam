import { AiProviderError, redact, type ProviderName } from "./providers";

export const NO_KEYS = "No AI key set. Add GEMINI_API_KEY, GROQ_API_KEY or OPENROUTER_API_KEY to .env.local and restart.";
const KEY_NAMES: Record<ProviderName, string> = { gemini: "GEMINI_API_KEY", groq: "GROQ_API_KEY", openrouter: "OPENROUTER_API_KEY" };

/** Thrown by readJsonBody; carries the HTTP status to reply with. */
class BadRequest extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Read a JSON body, rejecting anything over maxBytes (checks the header and the real length). */
export async function readJsonBody(req: Request, maxBytes: number): Promise<unknown> {
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) throw new BadRequest("Request too large.", 413);
  const raw = await req.text();
  if (raw.length > maxBytes) throw new BadRequest("Request too large.", 413);
  try {
    return JSON.parse(raw);
  } catch {
    throw new BadRequest("Invalid JSON body", 400);
  }
}

/**
 * Shared by all AI routes: turns a failure into a friendly JSON error.
 * Provider messages are logged server-side only; the client gets fixed text.
 */
export function errorResponse(err: unknown) {
  if (err instanceof BadRequest) return Response.json({ error: err.message }, { status: err.status });
  if (err instanceof AiProviderError) {
    const headers = err.provider ? { "x-ai-provider": err.provider } : undefined;
    const reply = (error: string, status: number, retryAfter?: number) => Response.json({ error, retryAfter }, { status, headers });
    switch (err.kind) {
      case "day":
        return reply("Daily AI limit reached on all providers. It resets tomorrow; the planner and revision still work.", 429);
      case "minute":
        return reply("AI rate limit reached. Wait a moment and try again.", 429, err.retryAfter ?? 30);
      case "auth":
        return reply(`The ${KEY_NAMES[err.provider ?? "gemini"]} was rejected. Check it in .env.local.`, 401);
      case "too-large":
        return reply("Input too long for the model. Use less material or a single topic.", 413);
      case "config":
        return reply(err.message === "No AI key set" ? NO_KEYS : "The configured AI model isn't available. Check GEMINI_MODEL / GROQ_MODEL / OPENROUTER_MODEL.", 500);
      case "bad-output":
        return reply(err.message, 502); // our own fixed messages
      case "unavailable":
        return reply("The AI service is unavailable or timed out. Try again shortly.", 503);
      default:
        console.warn(`[ai] request failed: ${redact(err.message).slice(0, 300)}`);
        return reply("The AI request failed. Try again.", err.status >= 400 && err.status < 600 ? err.status : 500);
    }
  }
  console.error(`[ai] unexpected error: ${redact(err instanceof Error ? err.message : String(err)).slice(0, 300)}`);
  return Response.json({ error: "The AI request failed. Try again." }, { status: 500 });
}
