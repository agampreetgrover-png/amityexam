// Server-only: download a public Drive file and turn it into plain text.
import path from "node:path";
import { Worker } from "node:worker_threads";
import { AiProviderError, getProviders } from "@/lib/ai/providers";

const MAX_BYTES = 40 * 1024 * 1024; // skip anything bigger (usually full textbooks)
const MAX_OCR_BYTES = 15 * 1024 * 1024; // Gemini inline-data limit with headroom
const MAX_TEXT = 400_000; // same cap the AI routes accept for `context`
const MAX_PDF_PAGES = 150; // longer PDFs are textbooks, not notes

/** Permanently ignore this file (wrong type, too big, empty). */
export class SkipFile extends Error {}
/** Can't read it right now (no Gemini key, or this run's scan budget is used up); try again on a later sync. */
export class DeferFile extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchBytes(url: string, signal?: AbortSignal): Promise<Buffer> {
  // Drive's download servers return the odd 429/5xx under load; retry those twice with backoff.
  const get = () => fetch(url, { signal, cache: "no-store", redirect: "follow" });
  let res = await get();
  for (let attempt = 1; attempt < 3 && (res.status === 429 || res.status >= 500); attempt++) {
    await sleep(1500 * attempt);
    res = await get();
  }
  if (!res.ok) throw new Error(`download failed (${res.status})`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new SkipFile(`too large (${Math.round(len / 1e6)}MB)`);
  // An HTML page instead of the file means it isn't public, or Drive's download quota was hit.
  if (res.headers.get("content-type")?.includes("text/html")) throw new Error("Drive returned a web page instead of the file (not shared publicly, or download limit hit)");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new SkipFile(`too large (${Math.round(buf.length / 1e6)}MB)`);
  return buf;
}

type Parsed = { text: string; pages: number };

// PDF, DOCX and PPTX parsing runs in a worker thread (extract-worker.mjs). pdf.js has no real worker on
// Node, so on the main thread a sync's parsing would hold up every page request the server handles.
let worker: Worker | null = null;
const waiting = new Map<number, { resolve: (p: Parsed) => void; reject: (e: Error) => void }>();
let nextId = 0;

function parse(ext: "pdf" | "docx" | "pptx", buf: Buffer): Promise<Parsed> {
  if (!worker) {
    // Loaded from disk, not bundled: Next would rewrite a bundled worker URL to a /_next/ path that doesn't exist.
    const w = new Worker(path.join(process.cwd(), "src/lib/drive/extract-worker.mjs"));
    w.unref(); // never keeps the server process alive on its own
    w.on("message", ({ id, result, error }: { id: number; result?: Parsed; error?: string }) => {
      const job = waiting.get(id);
      waiting.delete(id);
      if (error !== undefined) job?.reject(new Error(error));
      else job?.resolve(result!);
    });
    const fail = (e: Error) => {
      if (worker === w) worker = null; // the next file starts a fresh worker
      for (const job of waiting.values()) job.reject(e);
      waiting.clear();
    };
    w.on("error", fail);
    w.on("exit", (code) => fail(new Error(`text extractor stopped (${code})`)));
    worker = w;
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker!.postMessage({ id, ext, data: buf });
  });
}

const OCR_PROMPT =
  "Transcribe all text in this document faithfully. Keep headings, lists and tables as Markdown, and describe diagrams briefly in [brackets]. Output only the transcription.";

/** Returns the file's text; throws SkipFile when it should be ignored, Error when it failed. */
export async function fileText(
  entry: { id: string; name: string; type: string },
  { signal, takeOcrSlot }: { signal?: AbortSignal; takeOcrSlot: () => boolean },
): Promise<{ text: string; ocr: boolean }> {
  const clip = (s: string) => s.slice(0, MAX_TEXT);
  if (entry.type === "gdoc") {
    const buf = await fetchBytes(`https://docs.google.com/document/d/${entry.id}/export?format=txt`, signal);
    return { text: clip(buf.toString("utf8").replace(/^﻿/, "").trim()), ocr: false };
  }
  if (entry.type === "gslides") {
    const buf = await fetchBytes(`https://docs.google.com/presentation/d/${entry.id}/export/txt`, signal);
    return { text: clip(buf.toString("utf8").trim()), ocr: false };
  }

  const buf = await fetchBytes(`https://drive.usercontent.google.com/download?id=${entry.id}&export=download&confirm=t`, signal);
  const ext = entry.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === "docx" || ext === "pptx") return { text: clip((await parse(ext, buf)).text.trim()), ocr: false };
  if (ext === "txt" || ext === "md") return { text: clip(buf.toString("utf8").trim()), ocr: false };
  if (ext === "pdf") {
    const { text, pages } = await parse("pdf", buf);
    // Lecture notes and papers are short; a PDF this long is a textbook and would crowd out the notes as AI context.
    if (pages > MAX_PDF_PAGES) throw new SkipFile(`looks like a full book (${pages} pages)`);
    // Under ~40 characters per page means scanned images, not real text.
    if (text.length >= Math.max(200, pages * 40)) return { text: clip(text), ocr: false };
    const gemini = getProviders().find((p) => p.name === "gemini");
    if (buf.length > MAX_OCR_BYTES) throw new SkipFile("scanned PDF too large to read with AI");
    if (!gemini?.extract) throw new DeferFile("scanned PDF: add a Gemini key to read it");
    if (!takeOcrSlot()) throw new DeferFile("scanned PDF: queued for a later sync to save AI quota");
    const data = buf.toString("base64");
    // Transcribing is easy work: the lite model does it well and its free quota is far larger (the main
    // model's is ~20 requests a day), so it goes first and the main model only stands in when it's limited.
    const read = async () => {
      try {
        return await gemini.extract!({ mimeType: "application/pdf", data }, OCR_PROMPT, { fast: true });
      } catch (e) {
        if (!(e instanceof AiProviderError) || (e.kind !== "day" && e.kind !== "minute")) throw e;
        return await gemini.extract!({ mimeType: "application/pdf", data }, OCR_PROMPT);
      }
    };
    try {
      let ocr: string;
      try {
        ocr = await read();
      } catch (e) {
        // Gemini's "high demand" 503s are usually brief: one retry, then leave it for a later sync.
        if (!(e instanceof AiProviderError) || e.kind !== "unavailable") throw e;
        await sleep(4000);
        ocr = await read();
      }
      return { text: clip(ocr.trim()), ocr: true };
    } catch (e) {
      if (e instanceof AiProviderError) {
        const why = e.kind === "day" ? "daily AI limit reached" : e.kind === "minute" ? "AI rate limit" : e.kind === "unavailable" ? "AI busy" : "AI couldn't read it";
        throw new DeferFile(`scanned PDF: ${why}, will retry on a later sync`);
      }
      throw e;
    }
  }
  throw new SkipFile("unsupported file type");
}
