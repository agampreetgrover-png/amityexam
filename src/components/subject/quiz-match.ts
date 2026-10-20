export const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

// Strips list markers like "B)", "(b)", "2." and trailing full stops.
const bare = (s: string) => norm(s).replace(/^\(?[a-d1-4][).:]\s*/, "").replace(/[.\s]+$/, "");

/**
 * Models often answer "B", "B) foo" or a paraphrase instead of the exact option text.
 * Map the answer onto one of the options, or return null if none fits.
 */
export function matchOption(answer: string, options: string[]): string | null {
  const a = norm(answer);
  const exact = options.find((o) => norm(o) === a) ?? options.find((o) => bare(o) === bare(answer));
  if (exact) return exact;
  // A lone letter ("b"), a marked letter ("b)", "(b)") or "option b". Not a word like "a stack".
  const m = a.match(/^option\s*\(?([a-d])\)?\b|^\(?([a-d])(?:[).:]|$)/);
  const letter = m?.[1] ?? m?.[2];
  if (letter) return options["abcd".indexOf(letter)] ?? null;
  const ba = bare(answer);
  const contained = options.filter((o) => {
    const bo = bare(o);
    return bo.length > 2 && (ba.includes(bo) || bo.includes(ba));
  });
  return contained.length === 1 ? contained[0] : null;
}
