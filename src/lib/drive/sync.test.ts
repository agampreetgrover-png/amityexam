import { afterEach, describe, expect, it, vi } from "vitest";
import { syncDrive, type SyncEvent } from "./sync";

// The real extractor pulls in the AI providers through the "@/" alias, which vitest isn't set up for;
// this test stops before anything is downloaded anyway.
vi.mock("./extract", () => ({ SkipFile: class extends Error {}, DeferFile: class extends Error {}, fileText: vi.fn() }));

// Drive's embed page for a folder: a list of folder and file links.
const page = (entries: { id: string; name: string; folder?: boolean }[]) =>
  `<div class="flip-entries">${entries
    .map((e) => `<a href="${e.folder ? `https://drive.google.com/drive/folders/${e.id}` : `https://drive.google.com/file/d/${e.id}/view`}"><div class="flip-entry-title">${e.name}</div></a>`)
    .join("")}</div>`;

afterEach(() => vi.unstubAllGlobals());

describe("syncDrive", () => {
  it("skips a same-named copy in the other drive once the first copy was imported", async () => {
    const tree: Record<string, { id: string; name: string; folder?: boolean }[]> = {
      sourceAaaaa: [{ id: "folderAaaaa", name: "Database Management Systems", folder: true }],
      sourceBbbbb: [{ id: "folderBbbbb", name: "Database Management Systems", folder: true }],
      folderAaaaa: [{ id: "fileAaaaaaa", name: "Unit 1 Notes.pdf" }],
      folderBbbbb: [{ id: "fileBbbbbbb", name: "Unit 1 Notes (1).pdf" }],
    };
    vi.stubGlobal("fetch", async (url: string) => new Response(page(tree[new URL(url).searchParams.get("id")!] ?? [])));

    const events: SyncEvent[] = [];
    for await (const ev of syncDrive({
      subjects: [{ id: 1, name: "Database Management Systems" }],
      known: ["fileAaaaaaa"],
      sources: [{ id: "sourceAaaaa", label: "A" }, { id: "sourceBbbbb", label: "B" }],
    })) {
      events.push(ev);
      if (ev.type === "plan") break; // nothing is downloaded before the plan
    }
    expect(events.find((e) => e.type === "plan")).toEqual({ type: "plan", total: 0, remaining: 0 });
  });

  it("keeps same-named files in different subfolders", async () => {
    const tree: Record<string, { id: string; name: string; folder?: boolean }[]> = {
      sourceAaaaa: [{ id: "folderAaaaa", name: "Database Management Systems", folder: true }],
      folderAaaaa: [{ id: "pyqsAaaaaaa", name: "PYQs", folder: true }],
      pyqsAaaaaaa: [{ id: "y2022aaaaaa", name: "2022", folder: true }, { id: "y2023aaaaaa", name: "2023", folder: true }],
      y2022aaaaaa: [{ id: "file2022aaa", name: "Major.pdf" }],
      y2023aaaaaa: [{ id: "file2023aaa", name: "Major.pdf" }],
    };
    vi.stubGlobal("fetch", async (url: string) => new Response(page(tree[new URL(url).searchParams.get("id")!] ?? [])));

    const events: SyncEvent[] = [];
    for await (const ev of syncDrive({
      subjects: [{ id: 1, name: "Database Management Systems" }],
      known: [],
      sources: [{ id: "sourceAaaaa", label: "A" }],
    })) {
      events.push(ev);
      if (ev.type === "plan") break;
    }
    expect(events.find((e) => e.type === "plan")).toEqual({ type: "plan", total: 2, remaining: 0 });
  });

  it("keeps same-named files in different subfolders of a folder linked by hand", async () => {
    const tree: Record<string, { id: string; name: string; folder?: boolean }[]> = {
      linkedAaaaa: [{ id: "minorAaaaaa", name: "Minor", folder: true }, { id: "majorAaaaaa", name: "Major", folder: true }],
      minorAaaaaa: [{ id: "fileMinor01", name: "DBMS 2023.pdf" }],
      majorAaaaaa: [{ id: "fileMajor01", name: "DBMS 2023.pdf" }],
    };
    vi.stubGlobal("fetch", async (url: string) => new Response(page(tree[new URL(url).searchParams.get("id")!] ?? [])));

    const events: SyncEvent[] = [];
    for await (const ev of syncDrive({
      subjects: [{ id: 1, name: "Database Management Systems" }],
      known: [],
      sources: [],
      links: [{ subjectId: 1, folderIds: ["linkedAaaaa"] }],
    })) {
      events.push(ev);
      if (ev.type === "plan") break;
    }
    expect(events.find((e) => e.type === "plan")).toEqual({ type: "plan", total: 2, remaining: 0 });
  });

  it("still treats a linked folder's file and the same file in a source's subject folder as one copy", async () => {
    const tree: Record<string, { id: string; name: string; folder?: boolean }[]> = {
      linkedAaaaa: [{ id: "minorAaaaaa", name: "Minor", folder: true }],
      minorAaaaaa: [{ id: "fileLinked1", name: "DBMS 2023.pdf" }],
      sourceAaaaa: [{ id: "folderAaaaa", name: "Database Management Systems", folder: true }],
      folderAaaaa: [{ id: "minorBbbbbb", name: "Minor", folder: true }],
      minorBbbbbb: [{ id: "fileSource1", name: "DBMS 2023.pdf" }],
    };
    vi.stubGlobal("fetch", async (url: string) => new Response(page(tree[new URL(url).searchParams.get("id")!] ?? [])));

    const events: SyncEvent[] = [];
    for await (const ev of syncDrive({
      subjects: [{ id: 1, name: "Database Management Systems" }],
      known: [],
      sources: [{ id: "sourceAaaaa", label: "A" }],
      links: [{ subjectId: 1, folderIds: ["linkedAaaaa"] }],
    })) {
      events.push(ev);
      if (ev.type === "plan") break;
    }
    expect(events.find((e) => e.type === "plan")).toEqual({ type: "plan", total: 1, remaining: 0 });
  });
});

// Audit 1-2 Nov: a linked folder's PYQs/X.pdf and a source's mixed PYQs folder's X.pdf were keyed "pyqs/x.pdf"
// and "/x.pdf", so both came in.
describe("syncDrive: copies in a source's mixed past-papers folder", () => {
  const paper = "Database Management Systems 2023.pdf";
  const plan = async (
    tree: Record<string, { id: string; name: string; folder?: boolean }[]>,
    req: { known?: string[]; sources?: string[]; links?: string[] },
  ) => {
    vi.stubGlobal("fetch", async (url: string) => new Response(page(tree[new URL(url).searchParams.get("id")!] ?? [])));
    for await (const ev of syncDrive({
      subjects: [{ id: 1, name: "Database Management Systems" }],
      known: req.known ?? [],
      sources: (req.sources ?? []).map((id) => ({ id, label: id })),
      links: req.links && [{ subjectId: 1, folderIds: req.links }],
    })) {
      if (ev.type === "plan") return ev;
    }
  };
  // A source with a top-level "PYQs" folder holding papers of many subjects.
  const mixed = {
    sourceMixed: [{ id: "mixedPyqs01", name: "PYQs", folder: true }],
    mixedPyqs01: [{ id: "fileMixed01", name: paper }],
  };

  it("treats a linked folder's PYQs/X.pdf and the mixed folder's X.pdf as one copy", async () => {
    const tree = { ...mixed, linkedAaaaa: [{ id: "linkPyqs001", name: "PYQs", folder: true }], linkPyqs001: [{ id: "fileLinked1", name: paper }] };
    expect(await plan(tree, { sources: ["sourceMixed"], links: ["linkedAaaaa"] })).toEqual({ type: "plan", total: 1, remaining: 0 });
  });

  it("doesn't bring the mixed folder's copy in once the linked folder's copy was imported", async () => {
    const tree = { ...mixed, linkedAaaaa: [{ id: "linkPyqs001", name: "PYQs", folder: true }], linkPyqs001: [{ id: "fileLinked1", name: paper }] };
    const out = await plan(tree, { known: ["fileLinked1"], sources: ["sourceMixed"], links: ["linkedAaaaa"] });
    expect(out).toEqual({ type: "plan", total: 0, remaining: 0 });
  });

  it("treats a subject folder's PYQs/X.pdf in another source and the mixed folder's X.pdf as one copy", async () => {
    const tree = {
      ...mixed,
      sourceSubject: [{ id: "subjFolder1", name: "Database Management Systems", folder: true }],
      subjFolder1: [{ id: "subjPyqs001", name: "PYQs", folder: true }],
      subjPyqs001: [{ id: "fileSubjct1", name: paper }],
    };
    expect(await plan(tree, { sources: ["sourceSubject", "sourceMixed"] })).toEqual({ type: "plan", total: 1, remaining: 0 });
  });

  it("still treats a loose top-level X.pdf in another source and the mixed folder's X.pdf as one copy", async () => {
    const tree = { ...mixed, sourceLoose: [{ id: "fileLoose01", name: paper }] };
    expect(await plan(tree, { sources: ["sourceLoose", "sourceMixed"] })).toEqual({ type: "plan", total: 1, remaining: 0 });
  });

  it("keeps a mixed folder's papers in different year folders apart", async () => {
    const tree = {
      sourceMixed: [{ id: "mixedPyqs01", name: "PYQs", folder: true }],
      mixedPyqs01: [{ id: "mixed2022ff", name: "2022", folder: true }, { id: "mixed2023ff", name: "2023", folder: true }],
      mixed2022ff: [{ id: "fileMix2022", name: "Database Management Systems Major.pdf" }],
      mixed2023ff: [{ id: "fileMix2023", name: "Database Management Systems Major.pdf" }],
    };
    expect(await plan(tree, { sources: ["sourceMixed"] })).toEqual({ type: "plan", total: 2, remaining: 0 });
  });
});
