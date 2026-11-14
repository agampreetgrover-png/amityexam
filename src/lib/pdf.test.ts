import { beforeEach, describe, expect, it, vi } from "vitest";

const pageTexts: string[][] = [];
const extractWithAi = vi.fn();

vi.mock("./ai/client", () => ({ extractWithAi: (f: File) => extractWithAi(f) }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: pageTexts.length,
      getPage: async (i: number) => ({
        getTextContent: async () => ({ items: pageTexts[i - 1].map((str) => ({ str, hasEOL: true })) }),
      }),
    }),
    destroy: async () => {},
  }),
}));

const { extractAny } = await import("./pdf");

const pdf = () => new File(["%PDF"], "paper.pdf", { type: "application/pdf" });

describe("extractAny on PDFs", () => {
  beforeEach(() => {
    pageTexts.length = 0;
    extractWithAi.mockReset();
  });

  it("sends a scanned PDF with only a typed cover line to AI", async () => {
    pageTexts.push(["Amity University Uttar Pradesh - Syllabus"], ...Array.from({ length: 11 }, () => []));
    extractWithAi.mockResolvedValue("Full OCR text");
    const onStatus = vi.fn();
    await expect(extractAny(pdf(), { onStatus })).resolves.toBe("Full OCR text");
    expect(extractWithAi).toHaveBeenCalledOnce();
    expect(onStatus).toHaveBeenCalledWith("Reading scanned pages with AI…");
  });

  it("returns real text without calling AI", async () => {
    pageTexts.push(["x".repeat(300)], ["y".repeat(300)]);
    await expect(extractAny(pdf())).resolves.toBe(`${"x".repeat(300)}\n\n${"y".repeat(300)}`);
    expect(extractWithAi).not.toHaveBeenCalled();
  });

  it("keeps a short text PDF's own text when AI can't read it", async () => {
    pageTexts.push(["Exam postponed to Monday."]);
    extractWithAi.mockRejectedValue(new Error("Add an AI key"));
    await expect(extractAny(pdf())).resolves.toBe("Exam postponed to Monday.");
  });

  it("still surfaces the AI error for a PDF with no text at all", async () => {
    pageTexts.push([], []);
    extractWithAi.mockRejectedValue(new Error("Add an AI key"));
    await expect(extractAny(pdf())).rejects.toThrow("Add an AI key");
  });
});
