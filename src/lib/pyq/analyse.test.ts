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
const nav = { onLine: true };
vi.stubGlobal("navigator", nav);
// Just enough of `window` for the analyser to wait for the "online" event.
const win = new EventTarget();
vi.stubGlobal("window", win);
const { analyseAll, analyseSubject, remapSubject, setPaperExam } = await import("./analyse");

beforeEach(() => {
  aiJson.mockReset();
  nav.onLine = true;
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

describe("work asked for while another analysis runs", () => {
  it("analyses a subject's paper (an upload or a Retry) once the run in progress ends, instead of dropping it", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    aiJson.mockImplementation(async (action) => {
      if (action === "pyqmap") {
        await gate;
        return { map: [] };
      }
      return { year: 2024, exam: "end-term", questions: [{ number: "1", text: "Define normalisation." }] };
    });
    const busy = remapSubject(1); // holds the analysis lock until released
    tables.materials.push({ id: 9, subjectId: 1, kind: "pyq", fileName: "DBMS 2024.pdf", text: "Q1 Define normalisation." });
    await analyseSubject(1); // asked while busy: queued, not run
    expect(aiJson.mock.calls.some(([a]) => a === "pyq")).toBe(false);
    release();
    await busy;
    await vi.waitFor(() => expect(tables.materials.find((m) => m.id === 9)!.analysedAt).toBeDefined());
  });
});

// A paper reply with one question, and a gate that holds every topic-matching request until released.
const paperReply = { year: null, exam: "end-term", questions: [{ number: "1", text: "Define normalisation." }] };
const gated = () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  aiJson.mockImplementation(async (action) => {
    if (action === "pyqmap") {
      await gate;
      return { map: [] };
    }
    return paperReply;
  });
  return release;
};
const paperCalls = () => aiJson.mock.calls.filter(([a]) => a === "pyq").map(([, body]) => body.text);
/** Let every queued run (each starts on a timer once the one before ends) finish. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("the PYQs tab starting an analysis on its own (audit 1-2 Nov: extra AI calls)", () => {
  it("doesn't queue more work when the tab sees its own run's progress, and never runs other subjects", async () => {
    tables.subjects.push({ id: 2, name: "Maths" });
    tables.materials.push(
      { id: 20, subjectId: 1, kind: "pyq", fileName: "DBMS 2023.pdf", pyqExam: "end-term", text: "Q1" },
      { id: 21, subjectId: 2, kind: "pyq", fileName: "Maths 2023.pdf", pyqExam: "end-term", text: "Q1" },
    );
    tables.topics.push({ id: 5000, subjectId: 2, unitId: 2, title: "Limits" });
    tables.units.push({ id: 2, subjectId: 2, title: "Unit 1", order: 0 });
    const release = gated();
    const run = analyseSubject(1, { ifIdle: true }); // the tab opening
    // The tab's effect fires again as the paper is read and its questions wait for matching.
    await vi.waitFor(() => expect(paperCalls()).toEqual(["DBMS 2023.pdf"]));
    await analyseSubject(1, { ifIdle: true });
    await analyseSubject(1, { ifIdle: true });
    release();
    await run;
    await settle();
    const callsAfterRun = aiJson.mock.calls.length;
    // Only DBMS was touched: Maths's paper wasn't read and its questions weren't matched.
    expect(paperCalls()).toEqual(["DBMS 2023.pdf"]);
    expect(aiJson.mock.calls.every(([a, body]) => a === "pyq" || body.subject === "DBMS")).toBe(true);
    expect(tables.materials.find((m) => m.id === 21)!.analysedAt).toBeUndefined();
    await settle();
    expect(aiJson.mock.calls.length).toBe(callsAfterRun); // and nothing else was queued behind it
  });

  it("runs a request made during another run for that subject only, not as a full run", async () => {
    tables.subjects.push({ id: 2, name: "Maths" }, { id: 3, name: "Physics" });
    tables.materials.push(
      { id: 30, subjectId: 2, kind: "pyq", fileName: "Maths 2024.pdf", pyqExam: "end-term", text: "Q1" },
      { id: 31, subjectId: 3, kind: "pyq", fileName: "Physics 2024.pdf", pyqExam: "end-term", text: "Q1" },
    );
    const release = gated();
    const busy = remapSubject(1);
    await analyseSubject(2); // an upload to Maths while DBMS is being matched
    release();
    await busy;
    await vi.waitFor(() => expect(tables.materials.find((m) => m.id === 30)!.analysedAt).toBeDefined());
    await settle();
    expect(paperCalls()).toEqual(["Maths 2024.pdf"]);
    expect(tables.materials.find((m) => m.id === 31)!.analysedAt).toBeUndefined();
  });

  it("a re-tag during another run queues that paper's subject, not every subject", async () => {
    tables.subjects.push({ id: 2, name: "Maths" });
    tables.materials.push(
      { id: 40, subjectId: 1, kind: "pyq", fileName: "DBMS paper.pdf", text: "Q1" },
      { id: 41, subjectId: 2, kind: "pyq", fileName: "Maths 2024.pdf", pyqExam: "end-term", text: "Q1" },
    );
    const release = gated();
    const busy = remapSubject(1);
    await setPaperExam(40, "end-term");
    release();
    await busy;
    await vi.waitFor(() => expect(tables.materials.find((m) => m.id === 40)!.analysedAt).toBeDefined());
    await settle();
    expect(tables.materials.find((m) => m.id === 41)!.analysedAt).toBeUndefined();
  });

  it("a queued subject's older paper isn't crowded out by newer papers of other subjects", async () => {
    tables.subjects.push({ id: 2, name: "Maths" });
    tables.materials.push(
      { id: 50, subjectId: 1, kind: "pyq", fileName: "DBMS 2019.pdf", pyqExam: "end-term", text: "Q1" },
      ...Array.from({ length: 13 }, (_, n) => ({ id: 100 + n, subjectId: 2, kind: "pyq", fileName: `Maths 2025 set ${n}.pdf`, pyqExam: "end-term", text: "Q1" })),
    );
    const release = gated();
    const busy = remapSubject(1);
    await analyseSubject(1);
    release();
    await busy;
    await vi.waitFor(() => expect(tables.materials.find((m) => m.id === 50)!.analysedAt).toBeDefined());
    await settle();
    expect(paperCalls()).toEqual(["DBMS 2019.pdf"]);
  });

  it("a full run asked for during another run still runs after it", async () => {
    tables.subjects.push({ id: 2, name: "Maths" });
    tables.materials.push({ id: 60, subjectId: 2, kind: "pyq", fileName: "Maths 2024.pdf", pyqExam: "end-term", text: "Q1" });
    const release = gated();
    const busy = remapSubject(1);
    await analyseAll(); // a Drive sync finishing mid-run
    release();
    await busy;
    await vi.waitFor(() => expect(tables.materials.find((m) => m.id === 60)!.analysedAt).toBeDefined());
    await settle();
  });
});

describe("queued work while the device is offline (audit 1-2 Nov)", () => {
  it("keeps a queued re-match until the connection is back, instead of dropping it", async () => {
    tables.pyqQuestions.forEach((q) => (q.topicId = 1003)); // matched against the old syllabus
    const release = gated();
    const busy = remapSubject(1);
    await remapSubject(1); // the syllabus changed again mid-run: queued
    nav.onLine = false; // the run finishes, then the device drops offline
    release();
    await busy;
    const calls = aiJson.mock.calls.length;
    tables.pyqQuestions.forEach((q) => (q.topicId = 1003)); // what the queued re-match must reset and match again
    await settle();
    expect(aiJson.mock.calls.length).toBe(calls); // nothing can run offline
    nav.onLine = true;
    win.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(aiJson.mock.calls.length).toBeGreaterThan(calls));
    await settle();
    // The queued re-match ran: it forgot the old matches and asked again (this mock answers with no matches).
    expect(tables.pyqQuestions.map((q) => q.topicId)).toEqual([undefined, undefined]);
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
