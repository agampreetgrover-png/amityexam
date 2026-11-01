import { describe, expect, it } from "vitest";
import { fitSyncRequest, SYNC_LIMITS } from "./sync-request";

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
});
