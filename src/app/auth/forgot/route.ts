import { emailOnlyRoute } from "@/lib/auth/email-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /auth/forgot { email, captchaToken } → {} (always generic). Sends a password-recovery link. Where the link
// points comes from the project's email template (/auth/confirm#token_hash=…&type=recovery), never from this
// request's Host header, so a forged Host can't put another site's address into the email.
export const POST = emailOnlyRoute(["forgot:ip", "forgot:email"], "forgot", (supabase, email) => supabase.auth.resetPasswordForEmail(email));
