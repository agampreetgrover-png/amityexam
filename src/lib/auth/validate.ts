import { PASSWORD_MAX_BYTES, PASSWORD_MIN_CHARS, passwordProblem } from "./password-policy";

// Checks the browser runs before sending a form, only so mistakes show at once. The server checks everything again;
// nothing here decides who may sign in.

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_EMAIL_LENGTH = 254;

export const normalizeEmail = (email: string) => email.trim();

export function emailError(raw: string): string | undefined {
  const email = normalizeEmail(raw);
  if (!email) return "Enter your email address.";
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL.test(email)) return "Enter a full email address, like name@example.com.";
  return undefined;
}

/** For a new password (sign-up, reset). Signing in only needs one to be there: old passwords may predate the policy. */
export function newPasswordError(pw: string): string | undefined {
  switch (passwordProblem(pw)) {
    case "empty":
      return "Choose a password.";
    case "too-short":
      return `Use at least ${PASSWORD_MIN_CHARS} characters.`;
    case "too-long":
      return `That password is longer than ${PASSWORD_MAX_BYTES} bytes. Shorten it a little.`;
    default:
      return undefined;
  }
}

export function confirmError(pw: string, confirm: string): string | undefined {
  if (!confirm) return "Type the password again.";
  if (pw !== confirm) return "The passwords don't match.";
  return undefined;
}

const clean = <K extends string>(e: FieldErrors<K>) => Object.fromEntries(Object.entries(e).filter(([, v]) => v)) as FieldErrors<K>;

export type SignInFields = "email" | "password";
export function validateSignIn(v: { email: string; password: string }): FieldErrors<SignInFields> {
  return clean({ email: emailError(v.email), password: v.password ? undefined : "Enter your password." });
}

export type NewPasswordFields = "password" | "confirm";
export function validateNewPassword(v: { password: string; confirm: string }): FieldErrors<NewPasswordFields> {
  const password = newPasswordError(v.password);
  // A mismatch is only worth reporting once the first password is acceptable; otherwise it is noise.
  return clean({ password, confirm: password ? undefined : confirmError(v.password, v.confirm) });
}

export type SignUpFields = "email" | NewPasswordFields;
export function validateSignUp(v: { email: string; password: string; confirm: string }): FieldErrors<SignUpFields> {
  return clean({ email: emailError(v.email), ...validateNewPassword(v) });
}

export function validateEmailOnly(v: { email: string }): FieldErrors<"email"> {
  return clean({ email: emailError(v.email) });
}

export const hasErrors = (e: Record<string, string | undefined>) => Object.values(e).some(Boolean);
