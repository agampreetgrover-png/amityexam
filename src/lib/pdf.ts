"use client";

import { extractWithAi } from "./ai/client";

const SCANNED = "No text found. This PDF is probably scanned images.";

const isImage = (file: File) => file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name);

/**
 * Like extractText, but falls back to AI transcription for scanned PDFs and
 * photos of notes. onStatus reports when the slower AI path is in use.
 */
export async function extractAny(file: File, { onStatus }: { onStatus?: (s: string) => void } = {}): Promise<string> {
  if (isImage(file)) {
    onStatus?.("Reading the image with AI…");
    return extractWithAi(file);
  }
  try {
    return await extractText(file);
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith(SCANNED)) throw e;
    onStatus?.("Reading scanned pages with AI…");
    return extractWithAi(file);
  }
}

/** Extract plain text from an uploaded PDF or text file, entirely in the browser. */
async function extractText(file: File): Promise<string> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const pdfjs = await import("pdfjs-dist");
    // Copied to /public by the postinstall script.
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    // Each document gets its own pdf.js Web Worker, which only destroy() stops; without it every upload leaks one.
    const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
    const pages: string[] = [];
    try {
      const doc = await task.promise;
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
    } finally {
      await task.destroy();
    }
    const text = pages.join("\n\n").replace(/[^\S\n]+/g, " ").trim();
    if (!text) throw new Error(`${SCANNED} Paste the text instead.`);
    return text;
  }
  if (file.type.startsWith("text/") || /\.(txt|md|csv)$/i.test(file.name)) return (await file.text()).trim();
  throw new Error("Unsupported file. Upload a PDF, an image, or a .txt/.md file.");
}
