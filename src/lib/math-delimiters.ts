// Models (Gemini especially) often write LaTeX's own \( … \) and \[ … \] delimiters, which remark-math doesn't
// read, so the formula showed as raw TeX. These turn them into $ … $ and $$ … $$ before the Markdown is parsed.
// A one-line $$ … $$ on its own line is also opened up into a block: remark-math reads it as inline maths otherwise.

const FENCE = /^[ \t>]*(`{3,}|~{3,})/;
const HOLE = /\0(\d+)\0/g;

// The text is AI output, so untrusted. Delimiters are paired in one left-to-right pass rather than with lazy regexes
// like /\\\[([\s\S]+?)\\\]/, which retry from every unclosed opener: quadratic on text full of them.

/** The next `needle` at or after `from` that isn't escaped by a backslash ("\\[2pt]" is a TeX line break). */
function findUnescaped(s: string, needle: string, from: number): number {
  let at = s.indexOf(needle, from);
  while (at > 0 && s[at - 1] === "\\") at = s.indexOf(needle, at + 1);
  return at;
}

/** Each `open` … `close` pair (at least one character inside, the nearest close), replaced by `fn`. */
function replacePairs(s: string, open: string, close: string, fn: (all: string, tex: string, at: number) => string): string {
  let out = "";
  let from = 0;
  for (;;) {
    const a = findUnescaped(s, open, from);
    if (a < 0) break;
    const b = findUnescaped(s, close, a + open.length + 1);
    if (b < 0) break; // no close after this opener, so none after any later one either
    out += s.slice(from, a) + fn(s.slice(a, b + close.length), s.slice(a + open.length, b), a);
    from = b + close.length;
  }
  return out + s.slice(from);
}

/** Inline code spans: a run of backticks up to the next run of exactly the same length. */
function holdCodeSpans(s: string, hold: (code: string) => string): string {
  const runs = [...s.matchAll(/`+/g)].map((m) => ({ at: m.index, n: m[0].length }));
  // For each run, the next run of the same length (one pass from the end), so no run is searched from twice.
  const next: number[] = [];
  const lastOfLength = new Map<number, number>();
  for (let k = runs.length - 1; k >= 0; k--) {
    next[k] = lastOfLength.get(runs[k].n) ?? -1;
    lastOfLength.set(runs[k].n, k);
  }
  let out = "";
  let from = 0;
  for (let k = 0; k < runs.length; k++) {
    if (runs[k].at < from || next[k] < 0) continue;
    const end = runs[next[k]].at + runs[k].n;
    out += s.slice(from, runs[k].at) + hold(s.slice(runs[k].at, end));
    from = end;
    k = next[k];
  }
  return out + s.slice(from);
}
// A whole line that is just "$$…$$" (after any indent or "> "): display maths written on one line.
const OWN_LINE = /^([ \t>]*)\$\$([^\n$]+?)\$\$[ \t]*$/gm;

// Left alone: nothing inside, a "$" (it would end the new delimiter early), or a blank line (a stray "\[" that
// would otherwise swallow paragraphs up to the next "\]").
const keep = (tex: string) => !tex.trim() || tex.includes("$") || /\n[ \t]*\n/.test(tex);

export function normalizeMathDelimiters(md: string): string {
  if (!md.includes("\\(") && !md.includes("\\[") && !md.includes("$$")) return md;

  // Code is set aside first and put back at the end, untouched: fenced blocks (an unclosed one, still streaming,
  // runs to the end, as Markdown reads it), then inline `code`.
  const held: string[] = [];
  const hold = (s: string) => `\0${held.push(s) - 1}\0`;
  const lines = md.split("\n");
  const prose: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE.exec(lines[i]);
    if (!open) {
      prose.push(lines[i]);
      continue;
    }
    const mark = open[1];
    let j = i + 1;
    while (j < lines.length) {
      const close = FENCE.exec(lines[j]);
      if (close && close[1][0] === mark[0] && close[1].length >= mark.length && !lines[j].slice(close[0].length).trim()) break;
      j++;
    }
    prose.push(hold(lines.slice(i, j + 1).join("\n")));
    i = j;
  }
  let text = holdCodeSpans(prose.join("\n"), hold);

  const s = text;
  text = replacePairs(s, "\\[", "\\]", (all, tex, at) => {
    if (keep(tex)) return all;
    // On lines of its own it becomes a display block, its fences carrying the line's indent or "> " so it stays in
    // its list item or quote. Mid-sentence (or in a table cell) it stays in the line, which KaTeX sets inline.
    const before = s.slice(s.lastIndexOf("\n", at - 1) + 1, at);
    const end = s.indexOf("\n", at + all.length);
    const after = s.slice(at + all.length, end < 0 ? undefined : end);
    if (/^[ \t>]*$/.test(before) && !after.trim()) return `$$\n${before}${tex.trim()}\n${before}$$`;
    return `$$${tex.trim()}$$`;
  });
  text = replacePairs(text, "\\(", "\\)", (all, tex) => (keep(tex) ? all : `$${tex.trim()}$`));
  text = text.replace(OWN_LINE, (_all, lead: string, tex: string) => `${lead}$$\n${lead}${tex.trim()}\n${lead}$$`);

  // Twice over: a stray backtick can make an inline-code match take in a held fenced block.
  const restore = (s: string) => s.replace(HOLE, (all, n) => held[Number(n)] ?? all);
  return restore(restore(text));
}
