import { errorResponse, readJsonBody } from "@/lib/ai/errors";
import { extractWithFallback, getProviders } from "@/lib/ai/providers";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_BODY_BYTES = 21 * 1024 * 1024; // 15MB file ≈ 20MB as base64, plus JSON overhead
const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif"]);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const PROMPT = `Transcribe ALL the text in this file faithfully, in reading order. It is a student's study material (notes, slides, syllabus or a question paper).
- Keep headings, numbered/bulleted lists and tables as Markdown.
- Keep question numbers and marks, e.g. "Q3 (10 marks)".
- Describe diagrams, graphs and figures briefly in [square brackets].
- If handwriting is unclear, give your best reading followed by [?].
Output only the transcription, with no preamble.`;

/** Scanned PDFs and photos of notes → text: OpenRouter first, then Gemini. */
export async function POST(req: Request) {
  if (!getProviders().length)
    return Response.json({ error: "Reading scans/photos needs an OPENROUTER_API_KEY or GEMINI_API_KEY." }, { status: 501 });

  try {
    const body = (await readJsonBody(req, MAX_BODY_BYTES)) as { mimeType?: unknown; data?: unknown } | null;
    const mimeType = typeof body?.mimeType === "string" ? body.mimeType : "";
    const data = typeof body?.data === "string" ? body.data : "";
    if (!data) return Response.json({ error: "No file data" }, { status: 400 });
    if (!ALLOWED_TYPES.has(mimeType)) return Response.json({ error: "Only PDFs and images can be read." }, { status: 415 });
    if ((data.length * 3) / 4 > MAX_BYTES) return Response.json({ error: "File too large (max 15MB)." }, { status: 413 });
    if (!BASE64.test(data)) return Response.json({ error: "File data must be base64." }, { status: 400 });

    const { result: text, provider } = await extractWithFallback({ mimeType, data }, PROMPT);
    return Response.json({ text: text.trim() }, { headers: { "x-ai-provider": provider } });
  } catch (err) {
    return errorResponse(err);
  }
}
