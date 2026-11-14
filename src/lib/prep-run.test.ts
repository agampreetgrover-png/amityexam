import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Subject, Topic, Unit } from "./types";

const h = vi.hoisted(() => ({
  subjects: [] as Subject[],
  units: [] as Unit[],
  topics: [] as Topic[],
  updates: [] as { id: number; patch: unknown }[],
  requests: [] as { subject?: string; topics: string[] }[],
  reply: (() => ({ topics: [] })) as (body: { topics: string[] }) => unknown,
}));

// Read the run's state without React: the hook just returns the current snapshot.
vi.mock("react", () => ({ useSyncExternalStore: (_s: unknown, get: () => unknown) => get() }));
vi.mock("./ai/client", () => {
  class AiError extends Error {
    constructor(message: string, public retryAfter?: number) {
      super(message);
    }
  }
  return {
    AiError,
    aiJson: async (_kind: string, body: { subject?: string; topics: string[] }) => {
      h.requests.push(body);
      return h.reply(body);
    },
  };
});
vi.mock("./db", () => ({
  db: {
    subjects: { orderBy: () => ({ toArray: async () => h.subjects }) },
    units: { toArray: async () => h.units },
    topics: {
      toArray: async () => h.topics,
      update: async (id: number, patch: unknown) => (h.updates.push({ id, patch }), h.topics.some((t) => t.id === id) ? 1 : 0),
    },
    transaction: async (...args: unknown[]) => (args[args.length - 1] as () => Promise<unknown>)(),
  },
}));

import { ratePrep, usePrepRun } from "./prep-run";

const topic = (id: number): Topic => ({ id, subjectId: 1, unitId: 1, title: `Topic ${id}` }) as Topic;

beforeEach(() => {
  h.subjects = [{ id: 1, name: "Maths", color: "", createdAt: 0 }];
  h.units = [{ id: 1, subjectId: 1, title: "Unit 1", order: 0 } as Unit];
  h.topics = [topic(1), topic(2)];
  h.updates = [];
  h.requests = [];
});

describe("ratePrep", () => {
  it("reports an error when the AI's reply rates no topic, instead of ending silently", async () => {
    // Valid JSON, but every item dropped by the schema (or out of range): nothing saved, nothing thrown.
    h.reply = () => ({ topics: [{ i: 7, prep: 1, mins: 30, imp: 2, needs: null, why: null }] });
    await ratePrep();
    const run = usePrepRun();
    expect(h.updates).toHaveLength(0);
    expect(run.running).toBe(false);
    expect(run.error).toBeInstanceOf(Error);
    expect((run.error as Error).message).toMatch(/usable ratings/);
  });

  it("still reports success when topics are rated", async () => {
    h.reply = (b) => ({ topics: b.topics.map((_, i) => ({ i, prep: 1, mins: 30, imp: 2, needs: null, why: null })) });
    await ratePrep();
    const run = usePrepRun();
    expect(run.error).toBeNull();
    expect(run.message).toBe("2 topics rated.");
  });

  it("clips a long subject name to the AI route's 200-character limit", async () => {
    h.subjects[0].name = "Long course title ".repeat(20);
    h.reply = (b) => ({ topics: b.topics.map((_, i) => ({ i, prep: 1, mins: 30, imp: 2, needs: null, why: null })) });
    await ratePrep();
    expect(h.requests[0].subject!.length).toBeLessThanOrEqual(200);
    expect(usePrepRun().error).toBeNull();
  });
});
