import { describe, expect, it } from "vitest";
import { buildTextPrompt } from "./prompts";
import { AiRequestSchema } from "./schemas";

const limits = { maxChars: 12_000, chatHistory: 6 };
const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

describe("study chat images", () => {
  it("accepts up to four image data URLs and rejects anything else", () => {
    expect(AiRequestSchema.safeParse({ images: [jpeg] }).success).toBe(true);
    expect(AiRequestSchema.safeParse({ images: Array(5).fill(jpeg) }).success).toBe(false);
    expect(AiRequestSchema.safeParse({ images: ["https://example.com/a.jpg"] }).success).toBe(false);
    expect(AiRequestSchema.safeParse({ images: ["data:text/html;base64,PGI+"] }).success).toBe(false);
  });

  it("puts the images on the question, not on the history", () => {
    const msgs = buildTextPrompt("study", { subject: "DBMS", text: "Solve this", images: [jpeg], history: [{ role: "user", content: "earlier" }] }, limits);
    const last = msgs.at(-1)!;
    expect(last).toMatchObject({ role: "user", content: "Solve this", images: [jpeg] });
    expect(msgs.slice(0, -1).every((m) => !m.images)).toBe(true);
  });
});
