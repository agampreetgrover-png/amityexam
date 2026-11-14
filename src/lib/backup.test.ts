import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db, exportAll, importAll, validateBackup } from "./db";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("exportAll", () => {
  it("reads every table inside one read transaction, so a sync write can't land between two table reads", async () => {
    const log: string[] = [];
    let open = false;
    vi.spyOn(db, "transaction").mockImplementation((async (mode: string, tables: unknown, fn: () => Promise<void>) => {
      log.push(`tx ${mode} ${(tables as { name: string }[]).length}`);
      open = true;
      await fn();
      open = false;
    }) as never);
    for (const t of db.tables) {
      vi.spyOn(t, "toArray").mockImplementation((async () => {
        log.push(`${t.name}${open ? "" : " OUTSIDE"}`);
        return [{ from: t.name }];
      }) as never);
    }
    const out = await exportAll();
    expect(log[0]).toBe(`tx r ${db.tables.length}`);
    expect(log.filter((l) => l.endsWith("OUTSIDE"))).toEqual([]);
    expect(out.data.materials).toEqual([{ from: "materials" }]);
    expect(out.data.driveFiles).toEqual([{ from: "driveFiles" }]);
  });
});

describe("importAll", () => {
  const good = { app: "amityexams", version: 1, data: { subjects: [{ id: 3, name: "Physics", color: "#000", createdAt: 1 }] } };

  it("closes the app's connection before swapping the data, swaps on its own connection, then reloads", async () => {
    const log: string[] = [];
    vi.spyOn(db, "close").mockImplementation(() => void log.push("close db"));
    vi.spyOn(Dexie.prototype, "transaction").mockImplementation((async function (this: Dexie) {
      log.push(this === db ? "swap on db" : "swap on fresh");
    }) as never);
    vi.stubGlobal("location", { reload: () => log.push("reload") });
    await importAll(good);
    expect(log).toEqual(["close db", "swap on fresh", "reload"]);
  });

  it("reopens the app's connection and doesn't reload when the swap fails", async () => {
    const reload = vi.fn();
    vi.spyOn(db, "close").mockImplementation(() => {});
    const reopen = vi.spyOn(db, "open").mockImplementation((async () => db) as never);
    vi.spyOn(Dexie.prototype, "transaction").mockImplementation((async () => {
      throw new Error("ConstraintError");
    }) as never);
    vi.stubGlobal("location", { reload });
    await expect(importAll(good)).rejects.toThrow("ConstraintError");
    expect(reopen).toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});

const backup = (data: Record<string, unknown[]>) => ({ app: "amityexams", version: 1, data });

describe("validateBackup text fields", () => {
  it("accepts rows whose text fields are strings", () => {
    expect(() => validateBackup(backup({ subjects: [{ id: 1, name: "DBMS", color: "#4f46e5", createdAt: 1 }] }))).not.toThrow();
  });

  it("refuses a subject whose name isn't text (it would crash every page that sorts subjects)", () => {
    expect(() => validateBackup(backup({ subjects: [{ id: 1, name: 123, color: "#000", createdAt: 1 }] }))).toThrow(/subjects/);
  });

  it("refuses a material whose text is an object", () => {
    expect(() => validateBackup(backup({ materials: [{ id: 1, subjectId: 1, fileName: "a.pdf", text: {}, createdAt: 1 }] }))).toThrow(/materials/);
  });

  it("refuses a chat message with no content", () => {
    expect(() => validateBackup(backup({ messages: [{ id: 1, subjectId: 1, role: "user", createdAt: 1 }] }))).toThrow(/messages/);
  });
});

describe("validateBackup repairs", () => {
  it("gives a quiz with missing or wrong-shaped fields the arrays and score the Quiz tab reads", () => {
    const q1 = { type: "mcq", question: "Q1", answer: "A", explanation: {} };
    const data = validateBackup(backup({
      quizzes: [
        { subjectId: 1, score: 50, createdAt: 1 },
        { subjectId: 1, score: "x", createdAt: 1, topicIds: [2, "3", -1], questions: [null, q1, { question: 1, answer: "A" }], responses: ["skipped", 7] },
      ],
    }));
    expect(data.quizzes[0]).toMatchObject({ questions: [], responses: [], topicIds: [], score: 50 });
    expect(data.quizzes[1]).toMatchObject({ questions: [{ question: "Q1", answer: "A", explanation: undefined }], responses: [""], topicIds: [2], score: 0 });
  });

  it("drops chat sources that aren't a list of labelled sources", () => {
    const good = { kind: "notes", label: "unit1.pdf" };
    const data = validateBackup(backup({
      messages: [
        { subjectId: 1, role: "assistant", content: "a", createdAt: 1, sources: "x" },
        { subjectId: 1, role: "assistant", content: "b", createdAt: 1, sources: [good, { kind: "pyq" }, null] },
      ],
    }));
    expect(data.messages[0].sources).toBeUndefined();
    expect(data.messages[1].sources).toEqual([good]);
  });
});
