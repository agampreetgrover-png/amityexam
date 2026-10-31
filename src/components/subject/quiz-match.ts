export const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

// Strips list markers like "B)", "(b)", "2." and trailing full stops. The lookbehind starts the trailing match only
// at the start of a run: without it a long run of dots mid-answer is retried from every dot (quadratic).
const bare = (s: string) => norm(s).replace(/^\(?[a-d1-4][).:]\s*/, "").replace(/(?<![.\s])[.\s]+$/, "");

/**
 * Models often answer "B", "B) foo" or a paraphrase instead of the exact option text.
 * Map the answer onto one of the options, or return null if none fits.
 */
export function matchOption(answer: string, options: string[]): string | null {
  const a = norm(answer);
  const exact = options.find((o) => norm(o) === a) ?? options.find((o) => bare(o) === bare(answer));
  if (exact) return exact;
  // A lone letter or number ("b", "2"), a marked one ("b)", "(2)") or "option b". Not a word like "a stack".
  const m = a.match(/^option\s*\(?([a-d1-4])\)?\b|^\(?([a-d1-4])(?:[).:]|$)/);
  const letter = m?.[1] ?? m?.[2];
  if (letter) return options[/\d/.test(letter) ? Number(letter) - 1 : "abcd".indexOf(letter)] ?? null;
  const ba = bare(answer);
  // Too short to say which option it means ("2" is inside "O(n^2)").
  if (ba.length < 3) return null;
  const contained = options.filter((o) => {
    const bo = bare(o);
    return bo.length > 2 && (ba.includes(bo) || bo.includes(ba));
  });
  return contained.length === 1 ? contained[0] : null;
}
