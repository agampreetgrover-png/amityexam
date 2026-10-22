// Worker thread for Drive sync: turns a downloaded PDF, DOCX or PPTX into text.
// pdf.js has no real worker on Node, so parsing on the server's main thread would stall
// page requests while a sync runs; here it gets a thread of its own.
import { parentPort } from "node:worker_threads";

async function pdfText(data) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data, disableFontFace: true, useSystemFonts: false, useWorkerFetch: false });
  const doc = await task.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    let line = "";
    const lines = [];
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

async function pptxText(data) {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(data);
  const slides = Object.keys(zip.files)
    .map((f) => f.match(/^ppt\/slides\/slide(\d+)\.xml$/))
    .filter(Boolean)
    .sort((a, b) => Number(a[1]) - Number(b[1]));
  const out = [];
  for (const m of slides) {
    const xml = await zip.file(m[0]).async("string");
    // Each <a:p> is a paragraph; <a:t> holds its text runs.
    const paras = [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)]
      .map((p) => [...p[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join(""))
      .map((s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim())
      .filter(Boolean);
    if (paras.length) out.push(`## Slide ${m[1]}\n${paras.join("\n")}`);
  }
  return { text: out.join("\n\n"), pages: slides.length };
}

async function docxText(data) {
  const { default: mammoth } = await import("mammoth");
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return { text: (await mammoth.extractRawText({ buffer })).value, pages: 0 };
}

const PARSERS = { pdf: pdfText, pptx: pptxText, docx: docxText };

parentPort.on("message", async ({ id, ext, data }) => {
  try {
    parentPort.postMessage({ id, result: await PARSERS[ext](data) });
  } catch (e) {
    parentPort.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
});
