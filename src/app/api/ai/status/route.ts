import { providerStatus } from "@/lib/ai/providers";

export const dynamic = "force-dynamic";

/** Which AI providers have keys configured. Never returns the keys themselves. */
export function GET() {
  return Response.json(providerStatus(), { headers: { "Cache-Control": "no-store" } });
}
