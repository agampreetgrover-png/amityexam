// Server-only: download a public Drive file and turn it into plain text.
import JSZip from "jszip";
import mammoth from "mammoth";
import { AiProviderError, getProviders } from "@/lib/ai/providers";

const MAX_BYTES = 40 * 1024 * 1024; // skip anything bigger (usually full textbooks)
const MAX_OCR_BYTES = 15 * 1024 * 1024; // Gemini inline-data limit with headroom
export const MAX_TEXT = 400_000; // same cap the AI routes accept for `context`

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

async function pdfText(buf: Buffer): Promise<{ text: string; pages: number }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), disableFontFace: true, useSystemFonts: false, useWorkerFetch: false });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    let line = "";
    const lines: string[] = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line);
        line = "";
      } else line += " ";
    }
    if (line.trim()) lines.push(line);
    pages.push(lines.join("\n"));
  }
  const numPages = doc.numPages;
  await task.destroy();
  return { text: pages.join("\n\n").replace(/[ \t]+/g, " ").trim(), pages: numPages };
}

async function pptxText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files)
    .map((f) => f.match(/^ppt\/slides\/slide(\d+)\.xml$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .sort((a, b) => Number(a[1]) - Number(b[1]));
  const out: string[] = [];
  for (const m of slides) {
    const xml = await zip.file(m[0])!.async("string");
    // Each <a:p> is a paragraph; <a:t> holds its text runs.
    const paras = [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)]
      .map((p) => [...p[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join(""))
      .map((s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim())
      .filter(Boolean);
    if (paras.length) out.push(`## Slide ${m[1]}\n${paras.join("\n")}`);
  }
  return out.join("\n\n");
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
  if (ext === "docx") return { text: clip((await mammoth.extractRawText({ buffer: buf })).value.trim()), ocr: false };
  if (ext === "pptx") return { text: clip(await pptxText(buf)), ocr: false };
  if (ext === "txt" || ext === "md") return { text: clip(buf.toString("utf8").trim()), ocr: false };
  if (ext === "pdf") {
    const { text, pages } = await pdfText(buf);
    // Under ~40 characters per page means scanned images, not real text.
    if (text.length >= Math.max(200, pages * 40)) return { text: clip(text), ocr: false };
    const gemini = getProviders().find((p) => p.name === "gemini");
    if (buf.length > MAX_OCR_BYTES) throw new SkipFile("scanned PDF too large to read with AI");
    if (!gemini?.extract) throw new DeferFile("scanned PDF: add a Gemini key to read it");
    if (!takeOcrSlot()) throw new DeferFile("scanned PDF: queued for a later sync to save AI quota");
    const read = () => gemini.extract!({ mimeType: "application/pdf", data: buf.toString("base64") }, OCR_PROMPT);
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
