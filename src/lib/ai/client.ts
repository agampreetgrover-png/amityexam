"use client";

import type { AiRequest, FlashcardsResult, GradeResult, JsonAction, QuizResult, SyllabusResult, TextAction } from "./schemas";

export class AiError extends Error {
  constructor(message: string, public retryAfter?: number) {
    super(message);
  }
}

const PROVIDER_KEY = "amityexams:lastProvider";

/** Which provider (gemini/groq) answered the most recent AI request, and when. */
export function getLastProvider(): { provider: string; at: number } | null {
  try {
    const raw = localStorage.getItem(PROVIDER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function recordProvider(res: Response) {
  const provider = res.headers.get("x-ai-provider");
  if (!provider) return;
  try {
    localStorage.setItem(PROVIDER_KEY, JSON.stringify({ provider, at: Date.now() }));
  } catch {
    // storage unavailable; not important
  }
}

async function post(action: string, body: unknown, signal?: AbortSignal) {
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new AiError("You're offline. AI features need an internet connection.");
  const res = await fetch(`/api/ai/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  recordProvider(res);
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new AiError(j.error ?? `AI request failed (${res.status})`, j.retryAfter);
  }
  return res;
}

// Vercel rejects request bodies over ~4.5MB; base64 adds a third on top of the file size.
const MAX_PDF_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2000;

const toBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/** Downscale a photo so the long edge is at most 2000px, re-encoded as JPEG. */
async function shrinkImage(file: File): Promise<Blob> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new AiError("This image format can't be read here (HEIC photos often can't). Save it as JPG or PNG and try again.");
  }
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  if (!blob) throw new AiError("Couldn't process this image. Try a JPG or PNG.");
  return blob;
}

/** Transcribe a scanned PDF or a photo of notes to text using Gemini. */
export async function extractWithAi(file: File): Promise<string> {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  let blob: Blob = file;
  let mimeType = file.type || "application/pdf";
  if (isPdf) {
    if (file.size > MAX_PDF_BYTES) {
      throw new AiError("This scanned PDF is too large to send (max 3MB). Split it into smaller parts, or upload photos of the pages.");
    }
    mimeType = "application/pdf";
  } else {
    blob = await shrinkImage(file);
    mimeType = "image/jpeg";
  }
  const res = await post("extract", { fileName: file.name, mimeType, data: await toBase64(blob) });
  const { text } = (await res.json()) as { text?: string };
  if (!text?.trim()) throw new AiError("The AI couldn't find any readable text in this file.");
  return text.trim();
}

type JsonResults = { syllabus: SyllabusResult; flashcards: FlashcardsResult; quiz: QuizResult; grade: GradeResult };

export async function aiJson<A extends JsonAction>(action: A, body: AiRequest): Promise<JsonResults[A]> {
  return (await post(action, body)).json();
}

/** Streams text, calling onText with the full text so far. Resolves with the final text. */
export async function aiStream(action: TextAction, body: AiRequest, onText: (full: string) => void, signal?: AbortSignal) {
  const res = await post(action, body, signal);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    full += dec.decode(value, { stream: true });
    onText(full);
  }
  return full;
}
