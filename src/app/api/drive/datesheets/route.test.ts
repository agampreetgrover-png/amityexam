import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/drive/list", async (orig) => ({
  ...(await orig<typeof import("@/lib/drive/list")>()),
  listFolder: vi.fn(async (id: string) =>
    id === "SourceFolder01"
      ? [
          { id: "SubFolder0001", name: "Sem 3", type: "folder", url: "" },
          { id: "TopSheet00001", name: "End Sem Date Sheet.xlsx", type: "file", url: "" },
        ]
      : [
          { id: "PastPaper0001", name: "DBMS_Endsem_PYQ_2023.pdf", type: "file", url: "" },
          { id: "PastPaper0002", name: "OS_Midsem_Minor2.pdf", type: "file", url: "" },
          { id: "SheetFile0001", name: "Endsem_Datesheet_2024.pdf", type: "file", url: "" },
        ],
  ),
}));

const { GET } = await import("./route");

describe("GET /api/drive/datesheets", () => {
  it("lists date sheets but not past papers with underscored names", async () => {
    const res = await GET(new Request("http://x/api/drive/datesheets?source=SourceFolder01"));
    const names = ((await res.json()) as { name: string }[]).map((f) => f.name).sort();
    expect(names).toEqual(["End Sem Date Sheet.xlsx", "Endsem_Datesheet_2024.pdf"]);
  });
});
