/**
 * A model's JSON reply without the ```json fence some models wrap it in. Plain string work on purpose: the regex
 * this replaced backtracked on long runs of whitespace (seconds of CPU for a reply padded with spaces), and a
 * reply is untrusted input.
 */
export function stripFence(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.slice(3);
    if (s.slice(0, 4).toLowerCase() === "json") s = s.slice(4);
  }
  if (s.endsWith("```")) s = s.slice(0, -3);
  s = s.trim();
  // A sentence around the JSON ("Here you go: ```json {…} ``` Hope it helps"): keep the outermost object or array.
  if (!s.startsWith("{") && !s.startsWith("[")) {
    const brace = s.indexOf("{");
    const bracket = s.indexOf("[");
    const start = brace < 0 ? bracket : bracket < 0 ? brace : Math.min(brace, bracket);
    const end = start < 0 ? -1 : s.lastIndexOf(s[start] === "{" ? "}" : "]");
    if (end > start) s = s.slice(start, end + 1);
  }
  return s;
}
