import { describe, expect, it, vi } from "vitest";
import { parseSupabaseUrl, readAccountsConfig } from "./env";
import type { SUPABASE_PROJECTS } from "./projects";

// The tests below use these approved projects by default. The committed list (empty) is tested on its own, last.
vi.mock("./projects", () => ({ SUPABASE_PROJECTS: { development: ["devrefaaaaaaaaaaaaaa"], production: [], local: ["127.0.0.1"] } }));

const base = {
  SUPABASE_URL: "https://devrefaaaaaaaaaaaaaa.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_ENV: "development",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAAtest",
  TURNSTILE_SECRET_KEY: "0x4AAAAAAAtest-secret",
};
const vercel = { VERCEL: "1", UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t", RATE_LIMIT_SECRET: "s".repeat(32) };

describe("accounts environment guard", () => {
  it("is off when nothing is configured (today's production)", () => {
    expect(readAccountsConfig({})).toMatchObject({ enabled: false });
    expect(readAccountsConfig({ VERCEL: "1", VERCEL_ENV: "production" })).toMatchObject({ enabled: false });
  });

  it("local development: on with development settings, memory rate limits allowed", () => {
    const c = readAccountsConfig(base);
    expect(c).toMatchObject({ enabled: true, env: "development", projectRef: "devrefaaaaaaaaaaaaaa", upstash: null });
  });

  it("local development refuses production settings", () => {
    expect(readAccountsConfig({ ...base, SUPABASE_ENV: "production" })).toMatchObject({ enabled: false, reason: expect.stringContaining("needs development") });
  });

  it("Vercel Preview needs development settings", () => {
    expect(readAccountsConfig({ ...base, ...vercel, VERCEL_ENV: "preview" })).toMatchObject({ enabled: true, env: "development" });
    expect(readAccountsConfig({ ...base, ...vercel, VERCEL_ENV: "preview", SUPABASE_ENV: "production" })).toMatchObject({ enabled: false });
  });

  it("Vercel Production needs production settings and a committed production project", () => {
    const prodEnv = { ...base, ...vercel, VERCEL_ENV: "production", SUPABASE_URL: "https://prodrefaaaaaaaaaaaaa.supabase.co" };
    const projects = { development: ["devrefaaaaaaaaaaaaaa"], production: ["prodrefaaaaaaaaaaaaa"], local: [] };
    expect(readAccountsConfig({ ...prodEnv, SUPABASE_ENV: "development" }, projects)).toMatchObject({ enabled: false, reason: expect.stringContaining("needs production") });
    expect(readAccountsConfig({ ...prodEnv, SUPABASE_ENV: "production" }, projects)).toMatchObject({ enabled: true, env: "production", projectRef: "prodrefaaaaaaaaaaaaa" });
  });

  it("rejects an unknown SUPABASE_ENV value", () => {
    expect(readAccountsConfig({ ...base, SUPABASE_ENV: "staging" })).toMatchObject({ enabled: false });
    expect(readAccountsConfig({ ...base, SUPABASE_ENV: undefined })).toMatchObject({ enabled: false });
  });

  it("on Vercel, is off without the shared rate-limit store or a long enough secret", () => {
    const preview = { ...base, ...vercel, VERCEL_ENV: "preview" };
    expect(readAccountsConfig({ ...preview, UPSTASH_REDIS_REST_TOKEN: undefined })).toMatchObject({ enabled: false, reason: expect.stringContaining("UPSTASH") });
    expect(readAccountsConfig({ ...preview, RATE_LIMIT_SECRET: "short" })).toMatchObject({ enabled: false, reason: expect.stringContaining("RATE_LIMIT_SECRET") });
  });

  it("needs https, except a Supabase on this computer off Vercel", () => {
    expect(readAccountsConfig({ ...base, SUPABASE_URL: "http://devref.supabase.co" })).toMatchObject({ enabled: false });
    expect(readAccountsConfig({ ...base, SUPABASE_URL: "http://127.0.0.1:54321" })).toMatchObject({ enabled: true });
    expect(readAccountsConfig({ ...base, ...vercel, VERCEL_ENV: "preview", SUPABASE_URL: "http://127.0.0.1:54321" })).toMatchObject({ enabled: false });
    expect(readAccountsConfig({ ...base, SUPABASE_URL: "not a url" })).toMatchObject({ enabled: false });
  });

  it("needs the Turnstile site key", () => {
    expect(readAccountsConfig({ ...base, NEXT_PUBLIC_TURNSTILE_SITE_KEY: "" })).toMatchObject({ enabled: false });
  });

  // H1: the CAPTCHA is checked by this server, so without its secret there is no way to run accounts unprotected.
  it("needs the server-only Turnstile secret, everywhere", () => {
    for (const secret of [undefined, "", "   "]) {
      expect(readAccountsConfig({ ...base, TURNSTILE_SECRET_KEY: secret })).toMatchObject({ enabled: false, reason: expect.stringContaining("TURNSTILE_SECRET_KEY") });
      expect(readAccountsConfig({ ...base, ...vercel, VERCEL_ENV: "preview", TURNSTILE_SECRET_KEY: secret })).toMatchObject({ enabled: false });
    }
    expect(readAccountsConfig(base)).toMatchObject({ enabled: true, turnstileSecretKey: "0x4AAAAAAAtest-secret" });
  });

  it("Cloudflare's Turnstile test keys work locally and in Preview, never in Production", () => {
    const testKeys = { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA", TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" };
    expect(readAccountsConfig({ ...base, ...testKeys })).toMatchObject({ enabled: true });
    expect(readAccountsConfig({ ...base, ...vercel, VERCEL_ENV: "preview", ...testKeys })).toMatchObject({ enabled: true });
    const prod = { ...base, ...vercel, VERCEL_ENV: "production", SUPABASE_ENV: "production", SUPABASE_URL: "https://prodrefaaaaaaaaaaaaa.supabase.co" };
    const projects = { development: [], production: ["prodrefaaaaaaaaaaaaa"], local: [] };
    expect(readAccountsConfig(prod, projects)).toMatchObject({ enabled: true });
    for (const keys of [testKeys, { TURNSTILE_SECRET_KEY: "2x0000000000000000000000000000000AA" }, { NEXT_PUBLIC_TURNSTILE_SITE_KEY: "3x00000000000000000000FF" }]) {
      expect(readAccountsConfig({ ...prod, ...keys }, projects)).toMatchObject({ enabled: false, reason: expect.stringContaining("test keys") });
    }
  });

  it("production stays off until a production project is committed, and never uses the development project", () => {
    const prod = { ...base, ...vercel, VERCEL_ENV: "production", SUPABASE_ENV: "production" };
    // Nothing committed yet (today): off, whatever the variables say.
    expect(readAccountsConfig(prod, { development: [], production: [], local: [] })).toMatchObject({ enabled: false, reason: expect.stringContaining("isn't listed as a production project") });
    // The development project's URL pasted into production: refused.
    expect(readAccountsConfig(prod, { development: ["devrefaaaaaaaaaaaaaa"], production: ["prodrefaaaaaaaaaaaaa"], local: [] })).toMatchObject({ enabled: false, reason: expect.stringContaining("is a development project") });
  });

  it("development never uses the production project, and sticks to the listed development project", () => {
    expect(readAccountsConfig({ ...base, SUPABASE_URL: "https://prodrefaaaaaaaaaaaaa.supabase.co" }, { development: [], production: ["prodrefaaaaaaaaaaaaa"], local: [] })).toMatchObject({ enabled: false, reason: expect.stringContaining("is the production project") });
    expect(readAccountsConfig(base, { development: ["otherdevaaaaaaaaaaaa"], production: [], local: [] })).toMatchObject({ enabled: false, reason: expect.stringContaining("isn't listed as a development project") });
    expect(readAccountsConfig(base, { development: ["devrefaaaaaaaaaaaaaa"], production: [], local: [] })).toMatchObject({ enabled: true });
    // A Supabase running on this computer must be listed too, by its host, in the separate "local" list.
    const local = { ...base, SUPABASE_URL: "http://127.0.0.1:54321" };
    expect(readAccountsConfig(local, { development: ["devrefaaaaaaaaaaaaaa"], production: [], local: [] })).toMatchObject({ enabled: false, reason: expect.stringContaining("isn't listed as a local Supabase") });
    expect(readAccountsConfig(local, { development: ["127.0.0.1"], production: [], local: [] })).toMatchObject({ enabled: false, reason: expect.stringContaining("isn't listed as a local Supabase") }); // the wrong list doesn't count
    expect(readAccountsConfig(local, { development: [], production: [], local: ["127.0.0.1"] })).toMatchObject({ enabled: true });
  });

  it("with an empty development list, no project passes: not an arbitrary one, not even a valid-looking one", () => {
    const none = { development: [], production: [], local: [] };
    const preview = { ...base, ...vercel, VERCEL_ENV: "preview" };
    for (const url of ["https://devrefaaaaaaaaaaaaaa.supabase.co", "https://attackeraaaaaaaaaaaa.supabase.co", "http://127.0.0.1:54321"]) {
      expect(readAccountsConfig({ ...base, SUPABASE_URL: url }, none)).toMatchObject({ enabled: false, reason: expect.stringContaining("isn't listed") });
    }
    expect(readAccountsConfig(preview, none)).toMatchObject({ enabled: false, reason: expect.stringContaining("isn't listed as a development project") });
    // A listed development project doesn't let in an unlisted one.
    expect(readAccountsConfig({ ...base, SUPABASE_URL: "https://attackeraaaaaaaaaaaa.supabase.co" }, { development: ["devrefaaaaaaaaaaaaaa"], production: [], local: [] })).toMatchObject({ enabled: false });
  });

  it("the committed project lists are empty, so accounts are off locally, in Preview and in Production", async () => {
    const actual = (await vi.importActual<{ SUPABASE_PROJECTS: typeof SUPABASE_PROJECTS }>("./projects")).SUPABASE_PROJECTS;
    expect(actual).toEqual({ development: [], production: [], local: [] });
    const everyEnv = [
      base,
      { ...base, ...vercel, VERCEL_ENV: "preview" },
      { ...base, ...vercel, VERCEL_ENV: "production", SUPABASE_ENV: "production", SUPABASE_URL: "https://prodrefaaaaaaaaaaaaa.supabase.co" },
    ];
    for (const env of everyEnv) expect(readAccountsConfig(env, actual)).toMatchObject({ enabled: false, reason: expect.stringContaining("isn't listed") });
  });

  it("refuses secret and service-role keys as the publishable key, without echoing the key", () => {
    const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
    const secret = "sb_secret_abcdef1234567890";
    const r1 = readAccountsConfig({ ...base, SUPABASE_PUBLISHABLE_KEY: secret });
    expect(r1).toMatchObject({ enabled: false, reason: expect.stringContaining("secret key") });
    expect(JSON.stringify(r1)).not.toContain(secret);
    const service = jwt({ role: "service_role", ref: "devrefaaaaaaaaaaaaaa" });
    const r2 = readAccountsConfig({ ...base, SUPABASE_PUBLISHABLE_KEY: service });
    expect(r2).toMatchObject({ enabled: false, reason: expect.stringContaining("service-role") });
    expect(JSON.stringify(r2)).not.toContain(service);
    expect(readAccountsConfig({ ...base, SUPABASE_PUBLISHABLE_KEY: jwt({ role: "authenticated" }) })).toMatchObject({ enabled: false });
    expect(readAccountsConfig({ ...base, SUPABASE_PUBLISHABLE_KEY: "random-string" })).toMatchObject({ enabled: false });
    expect(readAccountsConfig({ ...base, SUPABASE_PUBLISHABLE_KEY: "a.b.c" })).toMatchObject({ enabled: false });
  });

  it("a key whose payload is JSON null, a number or a string turns accounts off instead of crashing", () => {
    for (const payload of ["null", "42", '"anon"']) {
      const key = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(payload).toString("base64url")}.sig`;
      expect(() => readAccountsConfig({ ...base, SUPABASE_PUBLISHABLE_KEY: key })).not.toThrow();
      expect(readAccountsConfig({ ...base, SUPABASE_PUBLISHABLE_KEY: key })).toMatchObject({ enabled: false, reason: expect.stringContaining("not a readable key") });
    }
  });

  it("accepts a legacy anon key only for its own project", () => {
    const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
    expect(readAccountsConfig({ ...base, SUPABASE_PUBLISHABLE_KEY: jwt({ role: "anon", ref: "devrefaaaaaaaaaaaaaa" }) })).toMatchObject({ enabled: true });
    expect(readAccountsConfig({ ...base, SUPABASE_PUBLISHABLE_KEY: jwt({ role: "anon", ref: "someoneelse" }) })).toMatchObject({ enabled: false, reason: expect.stringContaining("different project") });
  });

});

// S1.1 (mandatory): only https://<one-label ref>.supabase.co, or a Supabase on this computer off Vercel; every
// project still has to be listed. Each case below was either accepted before, or must stay refused.
describe("Supabase address validation", () => {
  const off = (url: string) => parseSupabaseUrl(url, { onVercel: false });
  const onV = (url: string) => parseSupabaseUrl(url, { onVercel: true });

  it("accepts a standard project address, and reads its ref", () => {
    expect(off("https://devrefaaaaaaaaaaaaaa.supabase.co")).toEqual({ kind: "project", ref: "devrefaaaaaaaaaaaaaa", origin: "https://devrefaaaaaaaaaaaaaa.supabase.co" });
    expect(off("https://DevRefAAAAAAAAAAAAAA.Supabase.co/")).toMatchObject({ kind: "project", ref: "devrefaaaaaaaaaaaaaa" }); // the URL parser lowercases
    expect(off("https://0123456789abcdefghij.supabase.co")).toMatchObject({ kind: "project", ref: "0123456789abcdefghij" }); // digits allowed
    expect(onV("https://abcdefghijklmnopqrst.supabase.co")).toMatchObject({ kind: "project", ref: "abcdefghijklmnopqrst" });
  });

  it("refuses ambiguous hosts that used to read as a listed ref", () => {
    expect(off("https://127.0.0.1.supabase.co")).toMatchObject({ kind: "invalid" }); // read as "127.0.0.1" before
    expect(off("https://devrefaaaaaaaaaaaaaa")).toMatchObject({ kind: "invalid" }); // a single-word host read as "devrefaaaaaaaaaaaaaa"
    expect(off("https://localhost.supabase.co")).toMatchObject({ kind: "invalid" }); // not a 20-character ref
  });

  it("requires a real ref: exactly 20 lowercase letters or digits", () => {
    expect(off(`https://${"a".repeat(19)}.supabase.co`)).toMatchObject({ kind: "invalid", reason: expect.stringContaining("exactly 20") });
    expect(off(`https://${"a".repeat(21)}.supabase.co`)).toMatchObject({ kind: "invalid", reason: expect.stringContaining("exactly 20") });
    expect(off("https://devref123.supabase.co")).toMatchObject({ kind: "invalid" }); // a made-up short ref
    expect(off(`https://${"a".repeat(20)}.supabase.co`)).toMatchObject({ kind: "project", ref: "a".repeat(20) });
  });

  it("keeps local hosts and real refs apart: an entry in one list never authorises an address of the other kind", () => {
    const ref = "devrefaaaaaaaaaaaaaa";
    // A real ref listed (by mistake) under "local" doesn't let in https://<ref>.supabase.co…
    expect(readAccountsConfig({ ...base, SUPABASE_URL: `https://${ref}.supabase.co` }, { development: [], production: [], local: [ref] })).toMatchObject({ enabled: false, reason: expect.stringContaining("isn't listed as a development project") });
    // …and a local host listed under "development" doesn't let in that local Supabase.
    expect(readAccountsConfig({ ...base, SUPABASE_URL: "http://localhost:54321" }, { development: ["localhost"], production: [], local: [] })).toMatchObject({ enabled: false, reason: expect.stringContaining("isn't listed as a local Supabase") });
    // "localhost" listed under local can't be reached through a *.supabase.co address at all.
    expect(readAccountsConfig({ ...base, ...vercel, VERCEL_ENV: "preview", SUPABASE_URL: "https://localhost.supabase.co" }, { development: ["localhost"], production: [], local: ["localhost"] })).toMatchObject({ enabled: false });
  });

  it("refuses trailing dots, dotted, hyphenated or empty refs, and look-alike domains", () => {
    for (const url of [
      "https://devrefaaaaaaaaaaaaaa.supabase.co.",
      "https://a.b.supabase.co",
      "https://dev-ref.supabase.co",
      "https://dev_ref.supabase.co",
      "https://xn--dvref-cva.supabase.co",
      "https://supabase.co",
      "https://devrefaaaaaaaaaaaaaa.supabase.co.evil.example",
      "https://devrefaaaaaaaaaaaaaa.supabase.com",
      "https://devrefaaaaaaaaaaaaaasupabase.co",
      "https://evilsupabase.co",
    ]) {
      expect(off(url), url).toMatchObject({ kind: "invalid" });
    }
  });

  it("refuses custom domains, even ones that front a real project", () => {
    expect(off("https://auth.example.com")).toMatchObject({ kind: "invalid", reason: expect.stringContaining("custom domains aren't supported") });
    expect(off("https://supabase.example.com")).toMatchObject({ kind: "invalid" });
  });

  it("refuses anything but the bare https origin of a project", () => {
    for (const url of [
      "http://devrefaaaaaaaaaaaaaa.supabase.co",
      "https://devrefaaaaaaaaaaaaaa.supabase.co:8443",
      "https://user:pass@devrefaaaaaaaaaaaaaa.supabase.co",
      "https://user@devrefaaaaaaaaaaaaaa.supabase.co",
      "https://devrefaaaaaaaaaaaaaa.supabase.co/rest/v1",
      "https://devrefaaaaaaaaaaaaaa.supabase.co/?x=1",
      "https://devrefaaaaaaaaaaaaaa.supabase.co/#frag",
      "ftp://devrefaaaaaaaaaaaaaa.supabase.co",
      "not a url",
      "",
    ]) {
      expect(off(url), url).toMatchObject({ kind: "invalid" });
    }
  });

  it("accepts a Supabase on this computer only off Vercel, and only these exact hosts", () => {
    expect(off("http://127.0.0.1:54321")).toMatchObject({ kind: "local", ref: "127.0.0.1" });
    expect(off("http://localhost:54321")).toMatchObject({ kind: "local", ref: "localhost" });
    expect(off("http://[::1]:54321")).toMatchObject({ kind: "local", ref: "[::1]" });
    for (const url of ["http://127.0.0.1:54321", "http://localhost:54321", "http://[::1]:54321", "https://localhost"]) {
      expect(onV(url), url).toMatchObject({ kind: "invalid", reason: expect.stringContaining("never allowed on Vercel") });
    }
    for (const url of ["http://127.0.0.2:54321", "http://0.0.0.0:54321", "http://localhost.:54321", "http://[::]:54321"]) {
      expect(off(url), url).toMatchObject({ kind: "invalid" });
    }
  });

  it("in the full guard: local addresses are refused in Preview and Production, even if listed", () => {
    const listed = { development: [], production: [], local: ["127.0.0.1", "localhost", "[::1]"] };
    const local = { ...base, SUPABASE_URL: "http://localhost:54321" };
    expect(readAccountsConfig(local, listed)).toMatchObject({ enabled: true, projectRef: "localhost" });
    expect(readAccountsConfig({ ...local, ...vercel, VERCEL_ENV: "preview" }, listed)).toMatchObject({ enabled: false, reason: expect.stringContaining("never allowed on Vercel") });
    expect(readAccountsConfig({ ...base, ...vercel, VERCEL_ENV: "production", SUPABASE_ENV: "production", SUPABASE_URL: "http://127.0.0.1:54321" }, listed)).toMatchObject({ enabled: false });
    // VERCEL_ENV alone (VERCEL missing) still counts as Vercel.
    expect(readAccountsConfig({ ...local, VERCEL_ENV: "preview", UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t", RATE_LIMIT_SECRET: "s".repeat(32) }, listed)).toMatchObject({ enabled: false, reason: expect.stringContaining("never allowed on Vercel") });
  });

  it("in the full guard: an ambiguous host is refused even when its old reading is listed", () => {
    const listed = { development: ["devrefaaaaaaaaaaaaaa"], production: [], local: ["127.0.0.1"] };
    expect(readAccountsConfig({ ...base, SUPABASE_URL: "https://127.0.0.1.supabase.co" }, listed)).toMatchObject({ enabled: false });
    expect(readAccountsConfig({ ...base, SUPABASE_URL: "https://devrefaaaaaaaaaaaaaa" }, listed)).toMatchObject({ enabled: false });
    expect(readAccountsConfig({ ...base, SUPABASE_URL: "https://devrefaaaaaaaaaaaaaa.supabase.co." }, listed)).toMatchObject({ enabled: false });
  });

  it("in the full guard: a well-formed address still needs listing, for the right environment", () => {
    const projects = { development: ["devrefaaaaaaaaaaaaaa"], production: ["prodrefaaaaaaaaaaaaa"], local: [] };
    const preview = { ...base, ...vercel, VERCEL_ENV: "preview" };
    const prod = { ...base, ...vercel, VERCEL_ENV: "production", SUPABASE_ENV: "production" };
    expect(readAccountsConfig(preview, projects)).toMatchObject({ enabled: true, projectRef: "devrefaaaaaaaaaaaaaa" });
    expect(readAccountsConfig({ ...prod, SUPABASE_URL: "https://prodrefaaaaaaaaaaaaa.supabase.co" }, projects)).toMatchObject({ enabled: true, projectRef: "prodrefaaaaaaaaaaaaa" });
    expect(readAccountsConfig({ ...preview, SUPABASE_URL: "https://unlistedaaaaaaaaaaaa.supabase.co" }, projects)).toMatchObject({ enabled: false, reason: expect.stringContaining("isn't listed") });
    expect(readAccountsConfig({ ...prod, SUPABASE_URL: "https://devrefaaaaaaaaaaaaaa.supabase.co" }, projects)).toMatchObject({ enabled: false, reason: expect.stringContaining("is a development project") });
    expect(readAccountsConfig({ ...preview, SUPABASE_URL: "https://prodrefaaaaaaaaaaaaa.supabase.co" }, projects)).toMatchObject({ enabled: false, reason: expect.stringContaining("is the production project") });
  });
});

// L3: the deployment is identified strictly; anything that looks like Vercel but can't be identified turns accounts off.
describe("deployment detection fails closed", () => {
  const preview = { ...base, ...vercel, VERCEL_ENV: "preview" };
  it("VERCEL set but VERCEL_ENV missing: off (never treated as this computer or as development)", () => {
    expect(readAccountsConfig({ ...base, ...vercel })).toMatchObject({ enabled: false, reason: expect.stringContaining("VERCEL_ENV is missing") });
    expect(readAccountsConfig({ ...base, ...vercel, VERCEL_ENV: "" })).toMatchObject({ enabled: false, reason: expect.stringContaining("can't tell which deployment") });
  });
  it("malformed, mixed-case or whitespace-padded VERCEL_ENV: off", () => {
    for (const value of ["staging", "Production", "PREVIEW", " preview", "preview ", "production\n", "dev"]) {
      for (const supabaseEnv of ["development", "production"]) {
        expect(readAccountsConfig({ ...preview, VERCEL_ENV: value, SUPABASE_ENV: supabaseEnv }), JSON.stringify(value) + " " + supabaseEnv).toMatchObject({ enabled: false, reason: expect.stringContaining("can't tell which deployment") });
      }
    }
  });
  it("each exact VERCEL_ENV value still works, with its own SUPABASE_ENV", () => {
    expect(readAccountsConfig(preview)).toMatchObject({ enabled: true, env: "development" });
    expect(readAccountsConfig({ ...preview, VERCEL_ENV: "development" })).toMatchObject({ enabled: true, env: "development" });
    const prodProjects = { development: [], production: ["prodrefaaaaaaaaaaaaa"], local: [] };
    expect(readAccountsConfig({ ...preview, VERCEL_ENV: "production", SUPABASE_ENV: "production", SUPABASE_URL: "https://prodrefaaaaaaaaaaaaa.supabase.co" }, prodProjects)).toMatchObject({ enabled: true, env: "production" });
  });
  it("this computer (neither variable set) with SUPABASE_ENV=development still works, and only development", () => {
    expect(readAccountsConfig(base)).toMatchObject({ enabled: true, env: "development" });
    expect(readAccountsConfig({ ...base, VERCEL: "", VERCEL_ENV: "" })).toMatchObject({ enabled: true, env: "development" });
    expect(readAccountsConfig({ ...base, SUPABASE_ENV: "production" })).toMatchObject({ enabled: false });
  });
});

// L2: the ref must be exactly 20 lowercase letters or digits. Every invalid ref below IS 20 characters long, so only
// the character rule can refuse it (a length check alone would let all of them through).
describe("project ref characters", () => {
  const parse = (ref: string) => parseSupabaseUrl("https://" + ref + ".supabase.co", { onVercel: false });
  const invalid20 = ["devref.aaaaaaaaaaaaa", "devref-aaaaaaaaaaaaa", "devref_aaaaaaaaaaaaa", "xn--aaaaaaaaaaaaaaaa", "xn--bcher-kvaaaaaaaa", "aaaaaaaaaaaaaaaaaa.a", "-aaaaaaaaaaaaaaaaaaa", "aaaaaaaaaaaaaaaaaaa_"];
  it("refuses 20-character refs containing dots, hyphens, underscores or an xn-- prefix", () => {
    for (const ref of invalid20) {
      expect(ref.length, ref).toBe(20);
      expect(parse(ref), ref).toMatchObject({ kind: "invalid" });
    }
  });
  it("refuses them in the full guard too, even when listed", () => {
    for (const ref of invalid20) {
      const r = readAccountsConfig({ ...base, SUPABASE_URL: "https://" + ref + ".supabase.co" }, { development: [ref], production: [], local: [] });
      expect(r, ref).toMatchObject({ enabled: false });
    }
  });
  it("accepts valid 20-character lowercase letter/digit refs", () => {
    for (const ref of ["abcdefghijklmnopqrst", "0123456789abcdefghij", "a1b2c3d4e5f6g7h8i9j0", "zzzzzzzzzzzzzzzzzzzz", "00000000000000000000"]) {
      expect(ref.length, ref).toBe(20);
      expect(parse(ref), ref).toMatchObject({ kind: "project", ref });
    }
  });
});
