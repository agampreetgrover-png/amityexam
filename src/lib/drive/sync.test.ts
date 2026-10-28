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
});
