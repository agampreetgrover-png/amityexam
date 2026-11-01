import { z } from "zod";
import { BadRequest, readJsonBody } from "@/lib/ai/errors";
import { MAX_DRIVE_SOURCES, MAX_SOURCE_LABEL } from "@/lib/drive/sources";
import { syncDrive } from "@/lib/drive/sync";
import { SYNC_LIMITS } from "@/lib/drive/sync-request";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_BODY_BYTES = 8 * 1024 * 1024; // `known` can hold 50,000 ids

const L = SYNC_LIMITS;
const Body = z.object({
  subjects: z.array(z.object({ id: z.number().int(), name: z.string().max(L.subjectName), code: z.string().max(L.subjectCode).optional() })).max(L.subjects),
  known: z.array(z.string().max(L.knownId)).max(L.known),
  sources: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{10,100}$/), label: z.string().max(MAX_SOURCE_LABEL) })).max(MAX_DRIVE_SOURCES),
  links: z.array(z.object({ subjectId: z.number().int(), folderIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{10,100}$/)).max(L.folderIdsPerLink) })).max(L.links).optional(),
  maxFiles: z.number().int().min(1).max(200).optional(),
  maxOcr: z.number().int().min(0).max(50).optional(),
});

/** Streams sync progress as newline-delimited JSON (one SyncEvent per line). */
export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await readJsonBody(req, MAX_BODY_BYTES);
  } catch (e) {
    return Response.json({ error: e instanceof BadRequest ? e.message : "Invalid sync request" }, { status: e instanceof BadRequest ? e.status : 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Invalid sync request" }, { status: 400 });
  const enc = new TextEncoder();
  const abort = new AbortController();
  return new Response(
    new ReadableStream({
      async start(controller) {
        try {
          for await (const ev of syncDrive(parsed.data, abort.signal)) {
            if (abort.signal.aborted) break; // the page closed; enqueueing now would throw
            controller.enqueue(enc.encode(JSON.stringify(ev) + "\n"));
          }
        } catch (e) {
          if (abort.signal.aborted) return;
          controller.enqueue(enc.encode(JSON.stringify({ type: "error", message: e instanceof Error ? e.message.slice(0, 200) : "Sync failed" }) + "\n"));
        }
        if (!abort.signal.aborted) controller.close();
      },
      cancel() {
        abort.abort();
      },
    }),
    { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } },
  );
}
