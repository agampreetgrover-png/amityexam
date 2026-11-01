import { describe, expect, it } from "vitest";
import { unlockClientKey } from "./unlock-page";
import { deploymentOf, isVercel } from "./vercel";

describe("deploymentOf: which deployment, failing closed", () => {
  it("this computer only when neither VERCEL nor VERCEL_ENV is set (empty counts as unset)", () => {
    expect(deploymentOf({})).toEqual({ kind: "local" });
    expect(deploymentOf({ VERCEL: "", VERCEL_ENV: "" })).toEqual({ kind: "local" });
  });

  it("each exact Vercel environment, with or without VERCEL", () => {
    for (const env of ["development", "preview", "production"] as const) {
      expect(deploymentOf({ VERCEL: "1", VERCEL_ENV: env })).toEqual({ kind: "vercel", env });
      expect(deploymentOf({ VERCEL_ENV: env })).toEqual({ kind: "vercel", env });
    }
  });

  it("VERCEL set but VERCEL_ENV missing → unknown, never this computer", () => {
    expect(deploymentOf({ VERCEL: "1" })).toMatchObject({ kind: "unknown", reason: expect.stringContaining("VERCEL_ENV is missing") });
    expect(deploymentOf({ VERCEL: "1", VERCEL_ENV: "" })).toMatchObject({ kind: "unknown" });
  });

  it("malformed, mixed-case or whitespace-padded VERCEL_ENV → unknown, never guessed", () => {
    for (const value of ["staging", "prod", "Production", "PRODUCTION", "Preview", " production", "production ", "\tpreview", "production\n", "dev", "local"]) {
      expect(deploymentOf({ VERCEL: "1", VERCEL_ENV: value }), JSON.stringify(value)).toMatchObject({ kind: "unknown" });
      expect(deploymentOf({ VERCEL_ENV: value }), JSON.stringify(value)).toMatchObject({ kind: "unknown" });
    }
  });
});

describe("isVercel: either variable means Vercel", () => {
  it("VERCEL and VERCEL_ENV combinations", () => {
    expect(isVercel({})).toBe(false);
    expect(isVercel({ VERCEL: "", VERCEL_ENV: "" })).toBe(false);
    expect(isVercel({ VERCEL: "1" })).toBe(true);
    expect(isVercel({ VERCEL_ENV: "preview" })).toBe(true);
    expect(isVercel({ VERCEL: "1", VERCEL_ENV: "production" })).toBe(true);
    expect(isVercel({ VERCEL_ENV: "Production" })).toBe(true); // malformed, but still recognisably Vercel
  });
});

describe("unlock attempt limit: whose guess it is", () => {
  const h = new Headers({ "x-real-ip": "203.0.113.7" });
  it("on Vercel (VERCEL or VERCEL_ENV), Vercel's own client address", () => {
    expect(unlockClientKey(h, "*", { VERCEL: "1" })).toBe("203.0.113.7");
    expect(unlockClientKey(h, "*", { VERCEL_ENV: "preview" })).toBe("203.0.113.7");
    expect(unlockClientKey(h, "*", { VERCEL: "1", VERCEL_ENV: "production" })).toBe("203.0.113.7");
  });
  it("anywhere else, the shared bucket (the header is whatever the client typed)", () => {
    expect(unlockClientKey(h, "*", {})).toBe("*");
    expect(unlockClientKey(new Headers(), "*", { VERCEL: "1" })).toBe("*");
  });
});
