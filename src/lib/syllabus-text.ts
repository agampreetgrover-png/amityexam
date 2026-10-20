/** Splits pasted syllabus text into topic titles: one per line, list markers, blanks and repeats dropped. */
export function parseTopics(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    // Strip "1.", "1)", "(a)", "a.", "ii.", "-", "*", "•" and similar markers pasted from a PDF or a list.
    const title = raw.replace(/^\s*(?:[-*•▪◦–]|\(?[0-9]{1,3}[.)]|\(?[a-z][.)]|[ivx]{1,4}[.)])\s*/i, "").trim();
    const key = title.toLowerCase();
    if (title && !seen.has(key)) {
      seen.add(key);
      out.push(title);
    }
  }
  return out;
}
