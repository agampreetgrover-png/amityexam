// The agreed password policy (Phase 2b, D9): at least 10 characters, at most 72 bytes, nothing else.
// No uppercase/number/symbol rules, and pasting and password managers are always allowed.
// 72 bytes is where bcrypt (which Supabase Auth uses) stops reading, so a longer password would be silently cut.

export const PASSWORD_MIN_CHARS = 10;
export const PASSWORD_MAX_BYTES = 72;

/** Characters as a person counts them: an emoji or an accented letter typed as one is one, not two UTF-16 units. */
export const passwordChars = (pw: string) => [...pw].length;
export const passwordBytes = (pw: string) => new TextEncoder().encode(pw).length;

export type PasswordProblem = "empty" | "too-short" | "too-long";

export function passwordProblem(pw: string): PasswordProblem | null {
  if (!pw) return "empty";
  if (passwordChars(pw) < PASSWORD_MIN_CHARS) return "too-short";
  if (passwordBytes(pw) > PASSWORD_MAX_BYTES) return "too-long";
  return null;
}

/**
 * The line under a new-password field, kept current as the person types. It states the rule, then where they are
 * against it, so nobody has to guess what "too long" means for a password full of non-English letters.
 */
export function passwordProgress(pw: string): { met: boolean; text: string } {
  const chars = passwordChars(pw);
  const bytes = passwordBytes(pw);
  if (bytes > PASSWORD_MAX_BYTES) return { met: false, text: "Too long: shorten it a little. Letters outside English count as more than one." };
  if (chars >= PASSWORD_MIN_CHARS) return { met: true, text: "Long enough." };
  if (chars === 0) return { met: false, text: `Use at least ${PASSWORD_MIN_CHARS} characters. A few unrelated words works well.` };
  const left = PASSWORD_MIN_CHARS - chars;
  return { met: false, text: `${left} more character${left === 1 ? "" : "s"} to go.` };
}
