import { describe, expect, it } from "vitest";
import { validateBackup } from "./db";

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
