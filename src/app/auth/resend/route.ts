import { emailOnlyRoute } from "@/lib/auth/email-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /auth/resend { email, captchaToken } → {} (always generic). Sends the sign-up confirmation again.
export const POST = emailOnlyRoute(["resend:ip", "resend:email"], "resend", (supabase, email) => supabase.auth.resend({ type: "signup", email }));
