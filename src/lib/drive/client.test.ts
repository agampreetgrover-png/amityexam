import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Subject } from "@/lib/types";

const h = vi.hoisted(() => ({
  subjects: [] as Subject[],
  addMaterial: async (): Promise<number> => 1,
}));

vi.mock("@/lib/db", () => ({
  db: {
    subjects: { toArray: async () => h.subjects, get: async (id: number) => h.subjects.find((s) => s.id === id) },
    driveFiles: { toCollection: () => ({ primaryKeys: async () => [] }), get: async () => undefined, put: async () => {} },
    materials: { add: () => h.addMaterial() },
    settings: { put: async () => {} },
    transaction: async (...args: unknown[]) => (args[args.length - 1] as () => Promise<unknown>)(),
  },
  getSettings: async () => ({ driveSources: [] }),
}));
vi.mock("@/lib/pyq/analyse", () => ({ analyseAll: async () => {} }));

import { runDriveSync } from "./client";

const folder = (n: number) => `folder-id-${String(n).padStart(4, "0")}`;
const ndjson = (events: unknown[]) => new Response(events.map((e) => JSON.stringify(e)).join("\n") + "\n");

beforeEach(() => {
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  h.addMaterial = async () => 1;
});

describe("runDriveSync request", () => {
  it("stays within the sync route's limits on subjects and linked folders", async () => {
    // 60 subjects (earlier semesters kept), the newest with 12 folders linked by hand.
    h.subjects = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, name: `Subject ${i + 1}`, color: "", createdAt: 0 }));
    h.subjects[59].driveFolderIds = Array.from({ length: 12 }, (_, i) => folder(i));
    const bodies: { subjects: { id: number }[]; links: { subjectId: number; folderIds: string[] }[] }[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return ndjson([{ type: "plan", total: 0, remaining: 0 }]);
    });

    await runDriveSync();

    expect(bodies).toHaveLength(1);
    const [body] = bodies;
    expect(body.subjects).toHaveLength(50);
    expect(body.subjects[0].id).toBe(11); // the newest 50 are kept
    expect(body.subjects.at(-1)!.id).toBe(60);
    expect(body.links).toHaveLength(1);
    expect(body.links[0].folderIds).toEqual(Array.from({ length: 10 }, (_, i) => folder(i + 2)));
  });
});

describe("runDriveSync stream", () => {
  it("cancels the response when saving an event fails, so the server stops working", async () => {
    h.subjects = [{ id: 1, name: "Maths", color: "", createdAt: 0, driveFolderIds: [folder(1)] }];
    h.addMaterial = async () => {
      throw new Error("QuotaExceededError");
    };
    const cancel = vi.fn();
    const file = { driveId: "d1", name: "notes.pdf", kind: "pdf", text: "x", url: "", path: "" };
    vi.stubGlobal("fetch", async () => {
      // The server would keep streaming the rest of the batch; this stream never closes on its own.
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode(JSON.stringify({ type: "file", subjectId: 1, file }) + "\n"));
        },
        cancel,
      });
      return new Response(body);
    });

    await runDriveSync();

    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
  });
});
