// Worker thread for Drive sync: turns a downloaded PDF, DOCX or PPTX into text.
// pdf.js has no real worker on Node, so parsing on the server's main thread would stall
// page requests while a sync runs; here it gets a thread of its own.
import { parentPort } from "node:worker_threads";

// A parser that fails to load says nothing about the file, so its error is marked to be tried again later.
const load = (name) => import(name).catch((e) => { throw Object.assign(e instanceof Error ? e : new Error(String(e)), { transient: true }); });

// Same caps as extract.ts, applied here so a huge file isn't read in full or copied back to the server whole.
const MAX_PDF_PAGES = 150;
const MAX_TEXT = 400_000;

async function pdfText(data) {
  const pdfjs = await load("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data, disableFontFace: true, useSystemFonts: false, useWorkerFetch: false });
  const doc = await task.promise;
  // A book is skipped on its page count alone (MAX_PDF_PAGES in extract.ts), so don't read its pages first.
  if (doc.numPages > MAX_PDF_PAGES) {
    const n = doc.numPages;
    await task.destroy();
    return { text: "", pages: n };
  }
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
  const { default: JSZip } = await load("jszip");
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
  const { default: mammoth } = await load("mammoth");
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return { text: (await mammoth.extractRawText({ buffer })).value, pages: 0 };
}

const PARSERS = { pdf: pdfText, pptx: pptxText, docx: docxText };

// The server sends one file at a time and waits for its answer, so replies need no id.
parentPort.on("message", async ({ ext, data }) => {
  try {
    const r = await PARSERS[ext](data);
    parentPort.postMessage({ result: { ...r, text: r.text.slice(0, MAX_TEXT) } });
  } catch (e) {
    parentPort.postMessage({ error: e instanceof Error ? e.message : String(e), transient: e?.transient === true });
  }
});
