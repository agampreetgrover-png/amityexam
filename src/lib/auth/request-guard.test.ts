import { describe, expect, it } from "vitest";
import { toResult } from "./client";
import { authRequestRefusal, isAuthPath, isJsonContentType, isSameOrigin } from "./request-guard";

// S1.2a: the check every state-changing /auth/* request passes, in the middleware AND in each handler. Every case is
// written out; a browser on our page sends Sec-Fetch-Site: same-origin and Origin: <our origin> with every POST.

const HOST = "exams.example.app";
const ORIGIN = `https://${HOST}`;
const req = (method: string, headers: Record<string, string>, url = `${ORIGIN}/auth/login`) =>
  new Request(url, { method, headers: { host: HOST, ...headers }, body: method === "GET" || method === "HEAD" ? undefined : "{}" });
const ours = { "sec-fetch-site": "same-origin", origin: ORIGIN, "content-type": "application/json" };

describe("isSameOrigin", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("our own page: Sec-Fetch-Site same-origin, Origin ours", () => expect(isSameOrigin(h({ "sec-fetch-site": "same-origin", origin: ORIGIN }), HOST)).toBe(true));
  it("only one of the two headers, and it says ours", () => {
    expect(isSameOrigin(h({ "sec-fetch-site": "same-origin" }), HOST)).toBe(true);
    expect(isSameOrigin(h({ origin: ORIGIN }), HOST)).toBe(true); // a browser without Fetch Metadata
  });
  it("host comparison ignores case and the scheme's default port", () => {
    expect(isSameOrigin(h({ origin: "https://EXAMS.example.app" }), "exams.example.app:443")).toBe(true);
    expect(isSameOrigin(h({ origin: "http://127.0.0.1:3000" }), "127.0.0.1:3000")).toBe(true);
  });
  const refused: [string, Record<string, string>, string?][] = [
    ["neither header (a script, not one of our pages)", {}],
    ["Sec-Fetch-Site cross-site", { "sec-fetch-site": "cross-site", origin: ORIGIN }],
    ["Sec-Fetch-Site same-site (a sibling subdomain)", { "sec-fetch-site": "same-site" }],
    ["Sec-Fetch-Site none (typed URL or bookmark: never one of our POSTs)", { "sec-fetch-site": "none" }],
    ["an unknown Sec-Fetch-Site value", { "sec-fetch-site": "maybe" }],
    ["headers that disagree (same-origin, but Origin is another site)", { "sec-fetch-site": "same-origin", origin: "https://evil.example" }],
    ["another site's Origin", { origin: "https://evil.example" }],
    ["a look-alike host", { origin: `https://${HOST}.evil.example` }],
    ["our host on another port", { origin: `https://${HOST}:8443` }],
    ["Origin: null (sandboxed frame, file:)", { origin: "null" }],
    ["a non-http(s) Origin", { origin: `ftp://${HOST}` }],
    ["a garbled Origin", { origin: "https://" }],
    ["no Host to compare with", { origin: ORIGIN }, ""],
    ["a garbled Host", { origin: ORIGIN }, "exams example app"],
  ];
  for (const [why, headers, host] of refused) it(`refuses ${why}`, () => expect(isSameOrigin(h(headers), host ?? HOST)).toBe(false));
});

describe("isJsonContentType", () => {
  it("accepts application/json, with parameters and any case", () => {
    for (const v of ["application/json", "application/json; charset=utf-8", "Application/JSON;charset=UTF-8", " application/json "]) expect(isJsonContentType(v)).toBe(true);
  });
  it("refuses everything a cross-site form or no-cors fetch can send, and look-alikes", () => {
    for (const v of [null, "", "text/plain", "text/plain;charset=utf-8", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "application/jsonx", "application/json-patch+json", "application/ld+json", "text/json", "json"]) {
      expect(isJsonContentType(v)).toBe(false);
    }
  });
});

describe("isAuthPath", () => {
  it("/auth and everything under it, nothing that only starts with the letters", () => {
    for (const p of ["/auth", "/auth/", "/auth/login", "/auth/session", "/auth/confirm"]) expect(isAuthPath(p)).toBe(true);
    for (const p of ["/authors", "/auth-x", "/api/auth/login", "/login", "/"]) expect(isAuthPath(p)).toBe(false);
  });
});

describe("authRequestRefusal (what every /auth/* handler calls first)", () => {
  it("lets our own JSON POST through", () => expect(authRequestRefusal(req("POST", ours))).toBeNull());
  it("GET and HEAD pass whatever their origin (they must change nothing; GET /auth/session is read by our pages)", () => {
    expect(authRequestRefusal(req("GET", { "sec-fetch-site": "cross-site", origin: "https://evil.example" }))).toBeNull();
    expect(authRequestRefusal(req("HEAD", {}))).toBeNull();
  });
  it("a cross-site POST → 403 blocked, as JSON, never cached", async () => {
    const res = authRequestRefusal(req("POST", { ...ours, "sec-fetch-site": "cross-site", origin: "https://evil.example" }))!;
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: { code: "blocked" } });
  });
  it("a POST with no origin headers at all → 403 (even with a JSON body)", () => {
    expect(authRequestRefusal(req("POST", { "content-type": "application/json" }))?.status).toBe(403);
  });
  it("same-origin but not JSON → 415 invalid_input (a form post or text/plain beacon)", async () => {
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const res = authRequestRefusal(req("POST", { ...ours, "content-type": type }))!;
      expect(res.status).toBe(415);
      expect(await res.json()).toEqual({ error: { code: "invalid_input" } });
    }
    expect(authRequestRefusal(req("POST", { "sec-fetch-site": "same-origin", origin: ORIGIN }))?.status).toBe(415); // no type
  });
  it("cross-site is checked before the type: a cross-site text/plain POST is 403, not 415", () => {
    expect(authRequestRefusal(req("POST", { "sec-fetch-site": "cross-site", "content-type": "text/plain" }))?.status).toBe(403);
  });
  it("other state-changing methods get the same checks (lower case included)", () => {
    for (const m of ["PUT", "PATCH", "DELETE", "OPTIONS", "patch"]) {
      expect(authRequestRefusal(req(m, { "sec-fetch-site": "cross-site" }))?.status).toBe(403);
      expect(authRequestRefusal(req(m, { "sec-fetch-site": "same-origin", origin: ORIGIN, "content-type": "text/plain" }))?.status).toBe(415);
    }
  });
  it("the browser client reads the refusals as intended (blocked, invalid_input)", async () => {
    const blocked = authRequestRefusal(req("POST", { "sec-fetch-site": "cross-site" }))!;
    expect(await toResult(blocked)).toEqual({ ok: false, code: "blocked" });
    const notJson = authRequestRefusal(req("POST", { ...ours, "content-type": "text/plain" }))!;
    expect(await toResult(notJson)).toEqual({ ok: false, code: "invalid_input" });
  });
});
