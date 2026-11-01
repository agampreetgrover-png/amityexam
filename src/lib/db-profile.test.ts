import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAll, closeDbForTests, db, exportAll, openDb, OwnerMismatchError, validateBackup } from "./db";
import { LOCAL, type Profile } from "./profile";

const A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const userA: Profile = { kind: "user", userId: A };

/** Read a database's owner marker directly, without going through openDb. */
async function ownerMarker(name: string) {
  const raw = new Dexie(name);
  await raw.open(); // dynamic mode: opens whatever version is on disk
  const row = raw.tables.some((t) => t.name === "meta") ? await raw.table("meta").get("owner") : undefined;
  raw.close();
  return row?.value as string | undefined;
}

beforeEach(async () => {
  closeDbForTests();
  await Dexie.delete("amityexams");
  await Dexie.delete(`amityexams-u-${A}`);
});
afterEach(() => closeDbForTests());

describe("db before it is opened", () => {
  it("throws instead of opening a default database", () => {
    expect(() => db.subjects).toThrow(/DB not opened/);
  });
});

describe("openDb owner marker", () => {
  it("marks a new Local Mode database as local and opens it again later", async () => {
    await openDb(LOCAL);
    await db.subjects.add({ name: "DBMS", color: "#000", createdAt: 1 });
    closeDbForTests();
    expect(await ownerMarker("amityexams")).toBe("local");
    await openDb(LOCAL);
    expect(await db.subjects.count()).toBe(1);
  });

  it("gives an account its own database, separate from Local Mode", async () => {
    await openDb(LOCAL);
    await db.subjects.add({ name: "Local only", color: "#000", createdAt: 1 });
    closeDbForTests();
    await openDb(userA);
    expect(await db.subjects.count()).toBe(0);
    closeDbForTests();
    expect(await ownerMarker(`amityexams-u-${A}`)).toBe(A);
  });

  it("refuses a database whose owner is someone else, and writes nothing to it", async () => {
    const other = new Dexie(`amityexams-u-${A}`);
    other.version(7).stores({ meta: "key", subjects: "++id, name" });
    await other.table("meta").add({ key: "owner", value: "local" }); // wrong owner for this name
    await other.table("subjects").add({ name: "Keep me", color: "#000", createdAt: 1 });
    other.close();

    await expect(openDb(userA)).rejects.toBeInstanceOf(OwnerMismatchError);
    expect(() => db.subjects).toThrow(/DB not opened/);
    expect(await ownerMarker(`amityexams-u-${A}`)).toBe("local");
  });

  it("won't open a second profile in the same page load", async () => {
    await openDb(LOCAL);
    await expect(openDb(userA)).rejects.toThrow(/page reload/);
    await expect(openDb(LOCAL)).resolves.toBeUndefined(); // the same one again is fine
  });

  it("upgrades an existing pre-profile database without losing data, and marks it local", async () => {
    const legacy = new Dexie("amityexams");
    legacy.version(6).stores({ subjects: "++id, name", chats: "++id, subjectId, updatedAt", messages: "++id, subjectId, createdAt, chatId", settings: "id" });
    await legacy.table("subjects").add({ name: "Old subject", color: "#000", createdAt: 1 });
    await legacy.table("settings").put({ id: "settings", notifications: true, examMode: "end-term" });
    legacy.close();

    await openDb(LOCAL);
    expect((await db.subjects.toArray()).map((s) => s.name)).toEqual(["Old subject"]);
    expect((await db.settings.get("settings"))?.examMode).toBe("end-term");
    closeDbForTests();
    expect(await ownerMarker("amityexams")).toBe("local");
  });
});

describe("the owner marker stays out of backups and clearing", () => {
  it("is not exported, is refused on import, and survives Clear all", async () => {
    await openDb(LOCAL);
    const backup = await exportAll();
    expect(Object.keys(backup.data)).not.toContain("meta");
    expect(() => validateBackup({ ...backup, data: { ...backup.data, meta: [{ key: "owner", value: A }] } })).toThrow(/unknown data/);
    await clearAll();
    closeDbForTests();
    expect(await ownerMarker("amityexams")).toBe("local");
  });
});

describe("importing the database module", () => {
  it("touches no browser storage and opens no database", async () => {
    vi.resetModules();
    const touched: string[] = [];
    const noop = function noop() {
      return null;
    };
    const storage = new Proxy({}, { get: (_t, p) => (touched.push(String(p)), noop) });
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    const open = vi.spyOn(indexedDB, "open");
    try {
      await import("./db");
      await import("./profile");
      expect(touched).toEqual([]);
      expect(open).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
