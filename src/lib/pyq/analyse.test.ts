import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiRequest } from "../ai/schemas";

// A tiny in-memory stand-in for the Dexie tables the analysis touches.
type Row = { id: number; [k: string]: unknown };
const tables: Record<string, Row[]> = {};
const table = (name: string) => {
  const rows = () => tables[name];
  const where = (q: Record<string, unknown>) => {
    const hit = () => rows().filter((r) => Object.entries(q).every(([k, v]) => r[k] === v));
    return {
      toArray: async () => hit(),
      sortBy: async (k: string) => [...hit()].sort((a, b) => Number(a[k]) - Number(b[k])),
      filter: (fn: (r: Row) => boolean) => ({ toArray: async () => hit().filter(fn) }),
      modify: async (fn: (r: Row) => void) => hit().forEach(fn),
      delete: async () => void (tables[name] = rows().filter((r) => !hit().includes(r))),
    };
  };
  return {
    get: async (id: number) => rows().find((r) => r.id === id),
    toArray: async () => rows(),
    filter: (fn: (r: Row) => boolean) => ({ toArray: async () => rows().filter(fn) }),
    where,
    update: async (id: number, patch: Record<string, unknown>) => {
      const r = rows().find((x) => x.id === id);
      if (r) Object.assign(r, patch);
      return r ? 1 : 0;
    },
    bulkAdd: async (xs: Row[]) => void rows().push(...xs),
  };
};
vi.mock("../db", () => ({
  db: {
    subjects: table("subjects"),
    units: table("units"),
    topics: table("topics"),
    materials: table("materials"),
    pyqQuestions: table("pyqQuestions"),
    transaction: async (...args: unknown[]) => (args[args.length - 1] as () => Promise<void>)(),
  },
}));

const aiJson = vi.fn<(action: string, body: AiRequest) => Promise<unknown>>();
vi.mock("../ai/client", () => ({
  AiError: class extends Error {
    retryAfter?: number;
  },
  aiJson: (action: string, body: AiRequest) => aiJson(action, body),
}));

// Node has a `navigator` without `onLine`, which would read as offline.
vi.stubGlobal("navigator", { onLine: true });
const { analyseSubject, remapSubject } = await import("./analyse");

beforeEach(() => {
  aiJson.mockReset();
  tables.subjects = [{ id: 1, name: "DBMS" }];
  tables.units = [{ id: 1, subjectId: 1, title: "Unit 1", order: 0 }];
  // More topics than one request may carry, and one title longer than the route accepts.
  tables.topics = Array.from({ length: 200 }, (_, n) => ({ id: 1000 + n, subjectId: 1, unitId: 1, title: n === 5 ? "x".repeat(400) : `Topic ${n}` }));
  tables.materials = [{ id: 7, subjectId: 1, kind: "pyq", fileName: "DBMS end term 2024.pdf", pyqExam: "end-term", text: "Q1 ...", analysedAt: 1 }];
  tables.pyqQuestions = [
    { id: 1, subjectId: 1, materialId: 7, exam: "end-term", text: "What is a B+ tree?" },
    { id: 2, subjectId: 1, materialId: 7, exam: "end-term", text: "Write about the weather." },
  ];
});

describe("matching questions to a long syllabus", () => {
  it("sends topics in slices the API accepts and maps indexes back to the whole syllabus", async () => {
    aiJson.mockImplementation(async (_action, body) => {
      expect(body.topics!.length).toBeLessThanOrEqual(150);
      expect(body.topics!.every((t) => t.length <= 300)).toBe(true);
      // The first slice fits neither question; in the second, topic 10 (Topic 160) fits the first one.
      return body.topics![0] === "Topic 0 (Unit 1)" ? { map: [{ i: 0, t: -1 }, { i: 1, t: -1 }] } : { map: [{ i: 0, t: 10 }, { i: 1, t: -1 }] };
    });
    await remapSubject(1);
    expect(aiJson).toHaveBeenCalledTimes(2);
    expect(tables.pyqQuestions.map((q) => q.topicId)).toEqual([1160, null]);
  });

  it("keeps the matches it got, but leaves a question unmatched when a slice failed", async () => {
    const { AiError } = await import("../ai/client");
    aiJson.mockImplementation(async (_action, body) => {
      if (body.topics![0] !== "Topic 0 (Unit 1)") throw new AiError("The AI returned an unexpected format. Try again.");
      return { map: [{ i: 0, t: 3 }, { i: 1, t: -1 }] };
    });
    await remapSubject(1);
    // Question 1 might have fitted a topic in the slice that failed, so it isn't written off as "no topic".
    expect(tables.pyqQuestions.map((q) => q.topicId)).toEqual([1003, undefined]);
  });
});

describe("reading a paper", () => {
  it("doesn't mark a paper analysed when the AI found no questions in it", async () => {
    tables.materials = [{ id: 8, subjectId: 1, kind: "pyq", fileName: "DBMS 2023.pdf", text: "scan noise" }];
    tables.pyqQuestions = [];
    aiJson.mockResolvedValue({ year: null, exam: null, questions: [] });
    await analyseSubject(1);
    expect(tables.materials[0].analysedAt).toBeUndefined();
    await analyseSubject(1); // not asked again this session
    expect(aiJson.mock.calls.filter(([a]) => a === "pyq")).toHaveLength(1);
  });
});
