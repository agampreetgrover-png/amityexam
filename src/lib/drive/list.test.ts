import { afterEach, describe, expect, it, vi } from "vitest";
import { claimFolder, crawl, newCrawlRun } from "./list";

// Drive's embed page for a folder: a list of folder and file links.
const page = (entries: { id: string; name: string; folder?: boolean }[]) =>
  `<div class="flip-entries">${entries
    .map((e) => `<a href="${e.folder ? `https://drive.google.com/drive/folders/${e.id}` : `https://drive.google.com/file/d/${e.id}/view`}"><div class="flip-entry-title">${e.name}</div></a>`)
    .join("")}</div>`;

function fakeDrive(tree: Record<string, { id: string; name: string; folder?: boolean }[]>) {
  const fetched: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    const id = new URL(url).searchParams.get("id")!;
    fetched.push(id);
    return new Response(page(tree[id] ?? []));
  });
  return fetched;
}

afterEach(() => vi.unstubAllGlobals());

describe("crawl", () => {
  it("lists each folder once, even when a subfolder links back to its parent", async () => {
    const fetched = fakeDrive({
      rootFolder01: [{ id: "subFolder001", name: "Notes", folder: true }, { id: "file1", name: "a.pdf" }],
      subFolder001: [{ id: "rootFolder01", name: "Back up", folder: true }, { id: "subFolder001", name: "Self", folder: true }, { id: "file2", name: "b.pdf" }],
    });
    const files = await crawl("rootFolder01");
    expect(files.map((f) => f.id).sort()).toEqual(["file1", "file2"]);
    expect(fetched).toEqual(["rootFolder01", "subFolder001"]);
  });

  it("shares what it has listed across one run", async () => {
    const fetched = fakeDrive({ rootFolder01: [{ id: "file1", name: "a.pdf" }] });
    const run = newCrawlRun();
    expect(await crawl("rootFolder01", { run })).toHaveLength(1);
    expect(await crawl("rootFolder01", { run })).toHaveLength(0); // the same id sent twice
    expect(fetched).toHaveLength(1);
  });

  it("stops listing once the run's folder budget is spent", () => {
    const run = newCrawlRun(2);
    expect(claimFolder(run, "a")).toBe(true);
    expect(claimFolder(run, "b")).toBe(true);
    expect(claimFolder(run, "c")).toBe(false);
  });
});
