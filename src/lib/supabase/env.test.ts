import { describe, expect, it, vi } from "vitest";
import { projectRefOf, readAccountsConfig } from "./env";
import type { SUPABASE_PROJECTS } from "./projects";

// The tests below use these approved projects by default. The committed list (empty) is tested on its own, last.
vi.mock("./projects", () => ({ SUPABASE_PROJECTS: { development: ["devref123", "127.0.0.1"], production: [] } }));

const base = {
  SUPABASE_URL: "https://devref123.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SUPABASE_ENV: "development",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAAtest",
};
const vercel = { VERCEL: "1", UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t", RATE_LIMIT_SECRET: "s".repeat(32) };

describe("accounts environment guard", () => {
  it("is off when nothing is configured (today's production)", () => {
    expect(readAccountsConfig({})).toMatchObject({ enabled: false });
    expect(readAccountsConfig({ VERCEL: "1", VERCEL_ENV: "production" })).toMatchObject({ enabled: false });
  });

  it("local development: on with development settings, memory rate limits allowed", () => {
    const c = readAccountsConfig(base);
    expect(c).toMatchObject({ enabled: true, env: "development", projectRef: "devref123", upstash: null });
  });

  it("local development refuses production settings", () => {
    expect(readAccountsConfig({ ...base, SUPABASE_ENV: "production" })).toMatchObject({ enabled: false, reason: expect.stringContaining("needs development") });
  });

  it("Vercel Preview needs development settings", () => {
    expect(readAccountsConfig({ ...base, ...vercel, VERCEL_ENV: "preview" })).toMatchObject({ enabled: true, env: "development" });
    expect(readAccountsConfig({ ...base, ...vercel, VERCEL_ENV: "preview", SUPABASE_ENV: "production" })).toMatchObject({ enabled: false });
  });

  it("Vercel Production needs production settings and a committed production project", () => {
    const prodEnv = { ...base, ...vercel, VERCEL_ENV: "production", SUPABASE_URL: "https://prodref999.supabase.co" };
    const projects = { development: ["devref123"], production: ["prodref999"] };
    expect(readAccountsConfig({ ...prodEnv, SUPABASE_ENV: "development" }, projects)).toMatchObject({ enabled: false, reason: expect.stringContaining("needs production") });
    expect(readAccountsConfig({ ...prodEnv, SUPABASE_ENV: "production" }, projects)).toMatchObject({ enabled: true, env: "production", projectRef: "prodref999" });
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

  it("production stays off until a production project is committed, and never uses the development project", () => {
    const prod = { ...base, ...vercel, VERCEL_ENV: "production", SUPABASE_ENV: "production" };
    // Nothing committed yet (today): off, whatever the variables say.
    expect(readAccountsConfig(prod, { development: [], production: [] })).toMatchObject({ enabled: false, reason: expect.stringContaining("isn't listed as a production project") });
    // The development project's URL pasted into production: refused.
    expect(readAccountsConfig(prod, { development: ["devref123"], production: ["prodref999"] })).toMatchObject({ enabled: false, reason: expect.stringContaining("is a development project") });
  });

  it("development never uses the production project, and sticks to the listed development project", () => {
    expect(readAccountsConfig({ ...base, SUPABASE_URL: "https://prodref999.supabase.co" }, { development: [], production: ["prodref999"] })).toMatchObject({ enabled: false, reason: expect.stringContaining("is the production project") });
    expect(readAccountsConfig(base, { development: ["otherdev"], production: [] })).toMatchObject({ enabled: false, reason: expect.stringContaining("isn't listed as a development project") });
    expect(readAccountsConfig(base, { development: ["devref123"], production: [] })).toMatchObject({ enabled: true });
    // A Supabase running on this computer must be listed too (by its host), like any other project.
    const local = { ...base, SUPABASE_URL: "http://127.0.0.1:54321" };
    expect(readAccountsConfig(local, { development: ["devref123"], production: [] })).toMatchObject({ enabled: false, reason: expect.stringContaining("isn't listed as a development project") });
    expect(readAccountsConfig(local, { development: ["127.0.0.1"], production: [] })).toMatchObject({ enabled: true });
  });

  it("with an empty development list, no project passes: not an arbitrary one, not even a valid-looking one", () => {
    const none = { development: [], production: [] };
    const preview = { ...base, ...vercel, VERCEL_ENV: "preview" };
    for (const url of ["https://devref123.supabase.co", "https://attackerproject.supabase.co", "http://127.0.0.1:54321"]) {
      expect(readAccountsConfig({ ...base, SUPABASE_URL: url }, none)).toMatchObject({ enabled: false, reason: expect.stringContaining("isn't listed as a development project") });
    }
    expect(readAccountsConfig(preview, none)).toMatchObject({ enabled: false, reason: expect.stringContaining("isn't listed as a development project") });
    // A listed development project doesn't let in an unlisted one.
    expect(readAccountsConfig({ ...base, SUPABASE_URL: "https://attackerproject.supabase.co" }, { development: ["devref123"], production: [] })).toMatchObject({ enabled: false });
  });

  it("the committed project lists are empty, so accounts are off locally, in Preview and in Production", async () => {
    const actual = (await vi.importActual<{ SUPABASE_PROJECTS: typeof SUPABASE_PROJECTS }>("./projects")).SUPABASE_PROJECTS;
    expect(actual).toEqual({ development: [], production: [] });
    const everyEnv = [
      base,
      { ...base, ...vercel, VERCEL_ENV: "preview" },
      { ...base, ...vercel, VERCEL_ENV: "production", SUPABASE_ENV: "production", SUPABASE_URL: "https://prodref999.supabase.co" },
    ];
    for (const env of everyEnv) expect(readAccountsConfig(env, actual)).toMatchObject({ enabled: false, reason: expect.stringContaining("isn't listed") });
  });

  it("refuses secret and service-role keys as the publishable key, without echoing the key", () => {
    const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
    const secret = "sb_secret_abcdef1234567890";
    const r1 = readAccountsConfig({ ...base, SUPABASE_PUBLISHABLE_KEY: secret });
    expect(r1).toMatchObject({ enabled: false, reason: expect.stringContaining("secret key") });
    expect(JSON.stringify(r1)).not.toContain(secret);
    const service = jwt({ role: "service_role", ref: "devref123" });
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
    expect(readAccountsConfig({ ...base, SUPABASE_PUBLISHABLE_KEY: jwt({ role: "anon", ref: "devref123" }) })).toMatchObject({ enabled: true });
    expect(readAccountsConfig({ ...base, SUPABASE_PUBLISHABLE_KEY: jwt({ role: "anon", ref: "someoneelse" }) })).toMatchObject({ enabled: false, reason: expect.stringContaining("different project") });
  });

  it("reads the project ref from the URL (logged instead of any key)", () => {
    expect(projectRefOf("https://abcdefgh.supabase.co")).toBe("abcdefgh");
    expect(projectRefOf("http://127.0.0.1:54321")).toBe("127.0.0.1");
  });
});
