// Server-only: download a public Drive file and turn it into plain text.
import path from "node:path";
import { Worker } from "node:worker_threads";
import { AiProviderError, extractWithFallback, getProviders } from "@/lib/ai/providers";
import { readLimited } from "@/lib/read-limited";

const MAX_BYTES = 40 * 1024 * 1024; // skip anything bigger (usually full textbooks)
const PARSE_TIMEOUT_MS = 90_000; // a file that takes longer is malformed (or hostile); give up on it for good
// Gemini (the fallback reader) takes 20MB per request, and base64 adds a third: 14MiB comes to ~19.6MB.
const MAX_OCR_BYTES = 14 * 1024 * 1024;
const MAX_TEXT = 400_000; // same cap the AI routes accept for `context`
const MAX_PDF_PAGES = 150; // longer PDFs are textbooks, not notes

/** Permanently ignore this file (wrong type, too big, empty). */
export class SkipFile extends Error {}
/** Can't read it right now (no AI key that reads files, or this run's scan budget is used up); try again on a later sync. */
export class DeferFile extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchBytes(url: string, signal?: AbortSignal): Promise<Buffer> {
  // Drive's download servers return the odd 429/5xx under load; retry those twice with backoff.
  const get = () => fetch(url, { signal, cache: "no-store", redirect: "follow" });
  let res = await get();
  for (let attempt = 1; attempt < 3 && (res.status === 429 || res.status >= 500); attempt++) {
    await res.body?.cancel().catch(() => {});
    await sleep(1500 * attempt);
    res = await get();
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`download failed (${res.status})`);
  }
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) {
    await res.body?.cancel().catch(() => {});
    throw new SkipFile(`too large (${Math.round(len / 1e6)}MB)`);
  }
  // An HTML page instead of the file means it isn't public, or Drive's download quota was hit.
  if (res.headers.get("content-type")?.includes("text/html")) {
    await res.body?.cancel().catch(() => {});
    throw new Error("Drive returned a web page instead of the file (not shared publicly, or download limit hit)");
  }
  const bytes = await readLimited(res.body, MAX_BYTES);
  if (!bytes) throw new SkipFile(`too large (over ${MAX_BYTES / 1e6}MB)`);
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

type Parsed = { text: string; pages: number };

// PDF, DOCX and PPTX parsing runs in a worker thread (extract-worker.mjs). pdf.js has no real worker on
// Node, so on the main thread a sync's parsing would hold up every page request the server handles.
//
// One file at a time. If files shared the worker, a slow one would eat into the time of every file sent
// alongside it, and a good file could time out and be skipped for good because of its neighbour. So each
// file's clock starts only when the worker actually starts on it, and a timeout or memory blow-up stops the
// worker with only that file on it.
const MEMORY_GROWTH = 768 * 1024 * 1024; // how much the process may grow while one file is read
const MEMORY_CHECK_MS = 100;

type Job = { ext: "pdf" | "docx" | "pptx"; buf: Buffer; resolve: (p: Parsed) => void; reject: (e: Error) => void };
const queue: Job[] = [];
let busy = false;
let worker: Worker | null = null;

function startWorker(): Worker {
  // Loaded from disk, not bundled: Next would rewrite a bundled worker URL to a /_next/ path that doesn't exist.
  // The heap cap means a zip bomb disguised as a DOCX/PPTX kills only this worker, not the server. It doesn't
  // cover ArrayBuffers (pdf.js's decompressed streams live there), which is what the memory watch is for.
  const w = new Worker(path.join(process.cwd(), "src/lib/drive/extract-worker.mjs"), { resourceLimits: { maxOldGenerationSizeMb: 1024 } });
  w.unref(); // never keeps the server process alive on its own
  return w;
}

function runNext() {
  if (busy) return;
  const job = queue.shift();
  if (!job) return;
  busy = true;
  const w = (worker ??= startWorker());
  const startRss = process.memoryUsage.rss();
  let settled = false;

  const finish = (outcome: { result: Parsed } | { error: Error }, stopWorker = false) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    clearInterval(watch);
    w.off("message", onMessage);
    w.off("error", onError);
    w.off("exit", onExit);
    if (stopWorker || worker !== w) {
      if (worker === w) worker = null; // the next file starts a fresh worker
      void w.terminate();
    }
    if ("result" in outcome) job.resolve(outcome.result);
    else job.reject(outcome.error);
    busy = false;
    runNext();
  };
  // A file the parser rejects (encrypted, corrupt) will be rejected again, so it's skipped for good rather than
  // downloaded on every sync. A parser that failed to load is the server's problem, so that file is tried again.
  const onMessage = ({ result, error, transient }: { result?: Parsed; error?: string; transient?: boolean }) =>
    finish(error === undefined ? { result: result! } : { error: transient ? new Error(error) : new SkipFile(`couldn't be read (${error.slice(0, 150)})`) });
  const onError = (e: Error & { code?: string }) =>
    // Out of heap is the file's doing (a zip bomb); anything else may be passing, so the file is tried again later.
    finish({ error: e.code === "ERR_WORKER_OUT_OF_MEMORY" ? new SkipFile("needs too much memory to read") : e }, true);
  const onExit = (code: number) => finish({ error: new Error(`text extractor stopped (${code})`) }, true);
  w.on("message", onMessage);
  w.on("error", onError);
  w.on("exit", onExit);

  // A parse that never finishes would hold the queue forever; stopping the worker is the only way to interrupt pdf.js.
  const timer = setTimeout(() => finish({ error: new SkipFile("took too long to read") }, true), PARSE_TIMEOUT_MS);
  const watch = setInterval(() => {
    if (process.memoryUsage.rss() - startRss > MEMORY_GROWTH) finish({ error: new SkipFile("needs too much memory to read") }, true);
  }, MEMORY_CHECK_MS);
  watch.unref();
  w.postMessage({ ext: job.ext, data: job.buf });
}

function parse(ext: Job["ext"], buf: Buffer): Promise<Parsed> {
  return new Promise<Parsed>((resolve, reject) => {
    queue.push({ ext, buf, resolve, reject });
    runNext();
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
    if (buf.length > MAX_OCR_BYTES) throw new SkipFile("scanned PDF too large to read with AI");
    if (!getProviders().length) throw new DeferFile("scanned PDF: add an OpenRouter or Gemini key to read it");
    if (!takeOcrSlot()) throw new DeferFile("scanned PDF: queued for a later sync to save AI quota");
    const data = buf.toString("base64");
    // OpenRouter reads it first. If Gemini has to, transcribing is easy work: the lite model does it well and its
    // free quota is far larger (the main model's is ~20 requests a day), so it goes first there.
    const read = async () => (await extractWithFallback({ mimeType: "application/pdf", data }, OCR_PROMPT, true)).result;
    try {
      let ocr: string;
      try {
        ocr = await read();
      } catch (e) {
        // "High demand" 503s are usually brief: one retry, then leave it for a later sync.
        if (!(e instanceof AiProviderError) || e.kind !== "unavailable") throw e;
        await sleep(4000);
        ocr = await read();
      }
      return { text: clip(ocr.trim()), ocr: true };
    } catch (e) {
      if (e instanceof AiProviderError) {
        // Too long for the model won't change by the next sync; asking again would only spend a scan slot each time.
        if (e.kind === "too-large") throw new SkipFile("scanned PDF too long for the AI to read");
        const why = e.kind === "day" ? "daily AI limit reached" : e.kind === "minute" ? "AI rate limit" : e.kind === "unavailable" ? "AI busy" : "AI couldn't read it";
        throw new DeferFile(`scanned PDF: ${why}, will retry on a later sync`);
      }
      throw e;
    }
  }
  throw new SkipFile("unsupported file type");
}
