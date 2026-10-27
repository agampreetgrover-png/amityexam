// Lightweight keyword retrieval over study material. No vector DB needed for one person's notes.

const STOP = new Set("the a an and or of to in on for is are was were be by with as at from that this it its what which how why when explain define describe".split(" "));

export const words = (s: string) => s.toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((w) => !STOP.has(w)) ?? [];

export function chunk(text: string, size = 1200): string[] {
  const paras = text.split(/\n\s*\n/);
  const out: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur.length + p.length > size && cur) {
      out.push(cur);
      cur = "";
    }
    cur += (cur ? "\n\n" : "") + p;
    while (cur.length > size * 1.5) {
      out.push(cur.slice(0, size));
      cur = cur.slice(size);
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Return the best-matching chunks (up to maxChars) for a query. */
export function retrieve(texts: string[], query: string, maxChars = 10_000): string {
  const q = new Set(words(query));
  if (!q.size) return "";
  const chunks = texts.flatMap((t) => chunk(t));
  const scored = chunks
    .map((c) => {
      const w = words(c);
      let hits = 0;
      for (const x of w) if (q.has(x)) hits++;
      return { c, score: hits / Math.sqrt(w.length + 1) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  let out = "";
  for (const { c } of scored) {
    if (out.length + c.length > maxChars) continue; // a smaller chunk may still fit
    out += (out ? "\n---\n" : "") + c;
  }
  return out;
}
