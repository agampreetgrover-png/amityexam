import { describe, expect, it } from "vitest";
import { timeOrNull } from "./schemas";

const t = (v: unknown) => timeOrNull.parse(v);

describe("exam start times from a date sheet", () => {
  it("reads single times", () => {
    expect(t("2:30 PM")).toBe("14:30");
    expect(t("14.30")).toBe("14:30");
    expect(t("10:00")).toBe("10:00");
    expect(t("12:00 AM")).toBe("00:00");
    expect(t("12:00 pm")).toBe("12:00");
    expect(t("9.30 a.m.")).toBe("09:30");
  });

  it("takes the AM/PM written after a range's end for its start", () => {
    expect(t("02:00 to 03:00 PM")).toBe("14:00");
    expect(t("2:00 - 5:00 PM")).toBe("14:00");
    expect(t("09:30 – 11:30 AM")).toBe("09:30");
    expect(t("12:00 to 03:00 PM")).toBe("12:00");
  });

  it("starts a range that crosses noon in the morning", () => {
    expect(t("10:00 to 01:00 PM")).toBe("10:00");
    expect(t("09:30 to 12:30 PM")).toBe("09:30");
  });

  it("keeps the start's own AM/PM and 24-hour starts as they are", () => {
    expect(t("11:00 AM to 02:00 PM")).toBe("11:00");
    expect(t("14:00 to 17:00")).toBe("14:00");
    expect(t("14:00 to 05:00 PM")).toBe("14:00");
  });

  it("gives null for anything that isn't a time", () => {
    expect(t("TBA")).toBeNull();
    expect(t(null)).toBeNull();
    expect(t("25:00")).toBeNull();
  });
});
