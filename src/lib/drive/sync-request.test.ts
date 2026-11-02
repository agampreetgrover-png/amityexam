import { describe, expect, it } from "vitest";
import { fitSyncRequest, isSyncFolderId, knownIds, SYNC_FOLDER_ID, SYNC_LIMITS } from "./sync-request";

describe("fitSyncRequest", () => {
  it("leaves an ordinary request as it is", () => {
    const out = fitSyncRequest([{ id: 1, name: "DBMS", code: "CSE201", driveFolderIds: ["folderAaaaa"] }, { id: 2, name: "Maths" }], ["a", "b"]);
    expect(out).toEqual({
      subjects: [
        { id: 1, name: "DBMS", code: "CSE201" },
        { id: 2, name: "Maths", code: undefined },
      ],
      known: ["a", "b"],
      links: [{ subjectId: 1, folderIds: ["folderAaaaa"] }],
    });
  });

  it("trims what the sync route would refuse, instead of failing the whole sync", () => {
    const folders = Array.from({ length: 12 }, (_, i) => `folder${String(i).padStart(6, "0")}`);
    const subjects = Array.from({ length: 60 }, (_, i) => ({ id: i, name: "x".repeat(300), code: "C".repeat(30), driveFolderIds: folders }));
    const out = fitSyncRequest(subjects, ["y".repeat(101), ...Array.from({ length: 50_010 }, (_, i) => `id${i}`)]);
    expect(out.subjects).toHaveLength(SYNC_LIMITS.subjects);
    expect(out.subjects.every((s) => s.name.length === SYNC_LIMITS.subjectName && s.code!.length === SYNC_LIMITS.subjectCode)).toBe(true);
    expect(out.links).toHaveLength(SYNC_LIMITS.links);
    expect(out.links.every((l) => l.folderIds.length === SYNC_LIMITS.folderIdsPerLink)).toBe(true);
    expect(out.known).toHaveLength(SYNC_LIMITS.known);
    expect(out.known.some((k) => k.length > SYNC_LIMITS.knownId)).toBe(false);
  });

  it("only links subjects that are sent", () => {
    const subjects = Array.from({ length: 51 }, (_, i) => ({ id: i, name: `S${i}`, driveFolderIds: i === 50 ? ["folderAaaaa"] : undefined }));
    expect(fitSyncRequest(subjects, []).links).toEqual([]);
  });

  // Audit 1-2 Nov: a folder id over 100 characters (a backup only checks for 10+) made the route refuse every sync.
  it("leaves out linked folder ids the route would refuse, and a link left with none", () => {
    const long = "a".repeat(101);
    const bad = Array.from({ length: 12 }, () => long);
    const out = fitSyncRequest(
      [
        { id: 1, name: "DBMS", driveFolderIds: [...bad, "folderAaaaa", "bad id!!!!!"] },
        { id: 2, name: "Maths", driveFolderIds: [long, "short"] },
      ],
      [],
    );
    // The good id isn't crowded out of the 10 slots by bad ones.
    expect(out.links).toEqual([{ subjectId: 1, folderIds: ["folderAaaaa"] }]);
  });

  it("uses the route's own folder id rule", () => {
    expect(isSyncFolderId("a".repeat(100))).toBe(true);
    expect(isSyncFolderId("a".repeat(101))).toBe(false);
    expect(isSyncFolderId("short")).toBe(false);
    expect(isSyncFolderId("has space 1")).toBe(false);
    expect(SYNC_FOLDER_ID.source).toBe("^[A-Za-z0-9_-]{10,100}$");
  });
});

// Audit 1-2 Nov: the ids came in Drive-id order, so past the cap the alphabetically first were dropped, not the oldest.
describe("knownIds", () => {
  it("lists files oldest first, then the ones tried this sync, so the cap drops the oldest", () => {
    const files = [
      { driveId: "zzzNewest", at: 300 },
      { driveId: "aaaOldest", at: 100 },
      { driveId: "mmmMiddle", at: 200 },
    ];
    expect(knownIds(files, ["triedOne", "mmmMiddle"])).toEqual(["aaaOldest", "zzzNewest", "triedOne", "mmmMiddle"]);
  });

  it("keeps the newest imports and this sync's tries when there are more than the request carries", () => {
    const files = Array.from({ length: SYNC_LIMITS.known + 5 }, (_, i) => ({ driveId: `id${String(i).padStart(6, "0")}`, at: SYNC_LIMITS.known + 5 - i }));
    const out = fitSyncRequest([], knownIds(files, ["triedNow01"])).known;
    expect(out).toHaveLength(SYNC_LIMITS.known);
    expect(out.at(-1)).toBe("triedNow01");
    expect(out).toContain("id000000"); // the newest import
    // The 6 oldest (the highest ids here) are the ones left out.
    for (let i = SYNC_LIMITS.known - 1; i < SYNC_LIMITS.known + 5; i++) expect(out).not.toContain(`id${String(i).padStart(6, "0")}`);
  });
});
