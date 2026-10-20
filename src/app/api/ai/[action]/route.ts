import type { z } from "zod";
import { buildJsonPrompt, buildTextPrompt } from "@/lib/ai/prompts";
import { errorResponse, NO_KEYS, readJsonBody } from "@/lib/ai/errors";
import { AiProviderError, getProviders, runWithFallback, type ProviderName } from "@/lib/ai/providers";
import {
  AiRequestSchema, FlashcardsSchema, GradeSchema, JSON_ACTIONS, QuizSchema, SyllabusSchema, TEXT_ACTIONS,
  type AiRequest, type JsonAction, type TextAction,
} from "@/lib/ai/schemas";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BODY_BYTES = 2 * 1024 * 1024; // Vercel caps bodies at ~4.5MB anyway

const schemas: Record<JsonAction, z.ZodTypeAny> = {
  syllabus: SyllabusSchema,
  flashcards: FlashcardsSchema,
  quiz: QuizSchema,
  grade: GradeSchema,
};

export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const isJson = (JSON_ACTIONS as readonly string[]).includes(action);
  const isText = (TEXT_ACTIONS as readonly string[]).includes(action);
  if (!isJson && !isText) return Response.json({ error: `Unknown action "${action}"` }, { status: 404 });
  if (!getProviders().length) return Response.json({ error: NO_KEYS }, { status: 500 });

  try {
    const parsedBody = AiRequestSchema.safeParse(await readJsonBody(req, MAX_BODY_BYTES));
    if (!parsedBody.success) return Response.json({ error: "Invalid request (a field is missing, malformed or too long)." }, { status: 400 });
    const body: AiRequest = parsedBody.data;

    if (isJson) {
      const a = action as JsonAction;
      // A malformed reply counts as a failure, so the next provider gets a chance.
      const { result, provider } = await runWithFallback(async (p) => {
        const raw = await p.json(buildJsonPrompt(a, body, { maxChars: p.maxContextChars, chatHistory: p.chatHistory }), { kind: "json" });
        let data: unknown;
        try {
          data = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
        } catch {
          throw new AiProviderError("The AI returned invalid JSON. Try again.", 502, "bad-output", undefined, p.name);
        }
        const parsed = schemas[a].safeParse(data);
        if (!parsed.success) throw new AiProviderError("The AI returned an unexpected format. Try again.", 502, "bad-output", undefined, p.name);
        return parsed.data;
      });
      return Response.json(result, { headers: { "x-ai-provider": provider } });
    }

    const a = action as TextAction;
    const chat = a === "chat";
    // Fallback is only possible before the first chunk; pull it here so errors surface early.
    const { result, provider } = await runWithFallback(async (p) => {
      const it = p.stream(buildTextPrompt(a, body, { maxChars: p.maxContextChars, chatHistory: p.chatHistory }), {
        fast: chat,
        kind: chat ? "chat" : "text",
      })[Symbol.asyncIterator]();
      const first = await it.next();
      return { it, first };
    });
    return streamResponse(result.it, result.first, provider);
  } catch (err) {
    return errorResponse(err);
  }
}

function streamResponse(it: AsyncIterator<string>, first: IteratorResult<string>, provider: ProviderName) {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      async start(controller) {
        try {
          if (!first.done) controller.enqueue(enc.encode(first.value));
          for (let r = first.done ? first : await it.next(); !r.done; r = await it.next()) controller.enqueue(enc.encode(r.value));
        } catch (e) {
          controller.enqueue(enc.encode(`\n\n[stream interrupted: ${e instanceof Error ? e.message.slice(0, 200) : "error"}]`));
        }
        controller.close();
      },
      async cancel() {
        await it.return?.();
      },
    }),
    { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "x-ai-provider": provider } },
  );
}
