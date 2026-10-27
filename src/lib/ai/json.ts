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
  return s.trim();
}
