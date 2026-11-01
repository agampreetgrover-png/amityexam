import { describe, expect, it } from "vitest";
import { securityHeaders } from "./security-headers";

// S0 only moves these out of next.config.ts. Any change to them is a deliberate, reviewed step (the CSP in S6).
describe("security headers", () => {
  it("are exactly the ones the deployed app already sends", () => {
    expect(Object.fromEntries(securityHeaders.map((h) => [h.key, h.value]))).toEqual({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
      "Content-Security-Policy": "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; img-src 'self' data: blob:",
      "Strict-Transport-Security": "max-age=31536000",
    });
  });
});
