import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Serwist's cacheOnNavigation stores every visited URL from a worker that never goes through the service worker's
// routes, so neverCache (sw-rules.ts) can't keep sign-in pages or one-time links out of it. It must stay off.
// (`npm run check:build` checks the build output for the same thing.)
const config = readFileSync(new URL("../../next.config.ts", import.meta.url), "utf8");

describe("service worker configuration", () => {
  it("keeps Serwist's cacheOnNavigation switched off", () => {
    expect(config).toMatch(/cacheOnNavigation:\s*false/);
    expect(config).not.toMatch(/cacheOnNavigation:\s*true/);
  });
  it("doesn't reload pages when the connection returns (would drop unsaved quiz answers)", () => {
    expect(config).toMatch(/reloadOnOnline:\s*false/);
  });
});
