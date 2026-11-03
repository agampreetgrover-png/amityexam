import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JWKS_MIN_REFETCH_MS, JWKS_TTL_MS, proveAccessToken, resetJwksCacheForTests } from "./token-proof";

// M1/M2: a session cookie's access token is checked against the project's PUBLISHED signing keys before anything
// spends a shared budget or asks Supabase. Only RS256 and ES256 can be checked here (the algorithms auth-js itself
// checks locally); HS256 can't (its secret is never published, and this app never holds it).

const URL_ = "https://devrefaaaaaaaaaaaaaa.supabase.co";
const PROJECT = { url: URL_, publishableKey: "sb_publishable_test" };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const claims = { iss: `${URL_}/auth/v1`, sub: "user-1", session_id: "sess-1", exp: 1 };

const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = (k: KeyObject, kid: string, alg: string) => ({ ...(k.export({ format: "jwk" }) as object), kid, alg, use: "sig" });
const EC_JWK = jwk(ec.publicKey, "ec-1", "ES256");
const RSA_JWK = jwk(rsa.publicKey, "rsa-1", "RS256");

function token(alg: "ES256" | "RS256", key: KeyObject, kid: string, payload: object = claims) {
  const signed = `${b64({ alg, typ: "JWT", kid })}.${b64(payload)}`;
  const sig = alg === "ES256" ? sign("sha256", Buffer.from(signed), { key, dsaEncoding: "ieee-p1363" }) : sign("sha256", Buffer.from(signed), key);
  return `${signed}.${sig.toString("base64url")}`;
}

let keys: unknown[] = [EC_JWK, RSA_JWK];
let jwksFetches = 0;
let jwksReply: "ok" | "network" | "500" = "ok";
beforeEach(() => {
  resetJwksCacheForTests();
  keys = [EC_JWK, RSA_JWK];
  jwksFetches = 0;
  jwksReply = "ok";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      expect(url).toBe(`${URL_}/auth/v1/.well-known/jwks.json`);
      jwksFetches++;
      if (jwksReply === "network") throw new TypeError("fetch failed");
      if (jwksReply === "500") return new Response("{}", { status: 500 });
      return new Response(JSON.stringify({ keys }), { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("proveAccessToken", () => {
  it("ES256 and RS256 tokens signed by a published key are verified, expiry ignored (expiring tokens get refreshed)", async () => {
    expect(await proveAccessToken(token("ES256", ec.privateKey, "ec-1"), PROJECT)).toEqual({ kind: "verified", userId: "user-1", sessionId: "sess-1" });
    expect(await proveAccessToken(token("RS256", rsa.privateKey, "rsa-1"), PROJECT)).toEqual({ kind: "verified", userId: "user-1", sessionId: "sess-1" });
    expect(jwksFetches).toBe(1); // the keys are fetched once and cached
  });

  it("forged: a published key id with another key's signature, or a payload changed after signing", async () => {
    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
    expect(await proveAccessToken(token("ES256", other, "ec-1"), PROJECT)).toEqual({ kind: "forged" });
    const real = token("ES256", ec.privateKey, "ec-1").split(".");
    const tampered = [real[0], b64({ ...claims, sub: "someone-else" }), real[2]].join(".");
    expect(await proveAccessToken(tampered, PROJECT)).toEqual({ kind: "forged" });
  });

  it("forged: a token that claims an algorithm its published key isn't for (algorithm confusion)", async () => {
    // ES256 in the header, but naming the RSA key's id.
    expect(await proveAccessToken(token("ES256", ec.privateKey, "rsa-1"), PROJECT)).toEqual({ kind: "forged" });
  });

  it("forged without fetching anything: not a token, alg none, junk segments", async () => {
    for (const t of [undefined, "", 42, "x.y.z", "a.b", "a.b.c.d", `${b64({ alg: "none" })}.${b64(claims)}.`, `${b64({ alg: "none", kid: "ec-1" })}.${b64(claims)}.c2ln`, "!!.??.**", "x".repeat(20_000)]) {
      expect(await proveAccessToken(t, PROJECT)).toEqual({ kind: "forged" });
    }
    expect(jwksFetches).toBe(0);
  });

  it("unverifiable, not forged: HS256 (the secret is never published) and algorithms auth-js can't check", async () => {
    const hs = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}.c2ln`;
    const eddsa = `${b64({ alg: "EdDSA", kid: "ed-1" })}.${b64(claims)}.c2ln`;
    const noKid = `${b64({ alg: "ES256" })}.${b64(claims)}.c2ln`;
    for (const t of [hs, eddsa, noKid]) expect(await proveAccessToken(t, PROJECT)).toEqual({ kind: "unverifiable" });
    expect(jwksFetches).toBe(0);
  });

  it("unverifiable when the key id isn't published (e.g. a revoked key) or the keys can't be fetched", async () => {
    expect(await proveAccessToken(token("ES256", ec.privateKey, "revoked-key"), PROJECT)).toEqual({ kind: "unverifiable" });
    resetJwksCacheForTests();
    jwksReply = "network";
    expect(await proveAccessToken(token("ES256", ec.privateKey, "ec-1"), PROJECT)).toEqual({ kind: "unverifiable" });
    resetJwksCacheForTests();
    jwksReply = "500";
    expect(await proveAccessToken(token("ES256", ec.privateKey, "ec-1"), PROJECT)).toEqual({ kind: "unverifiable" });
  });

  it("an HS256-only project publishes no keys: every token is unverifiable, and the empty list is cached too", async () => {
    keys = [];
    for (let i = 0; i < 5; i++) expect(await proveAccessToken(token("ES256", ec.privateKey, "ec-1"), PROJECT)).toEqual({ kind: "unverifiable" });
    expect(jwksFetches).toBe(1);
  });

  it("made-up key ids can't make this server fetch: at most one fetch per minute, whatever kids requests name", async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    for (let i = 0; i < 50; i++) await proveAccessToken(token("ES256", ec.privateKey, `random-${i}`), PROJECT);
    expect(jwksFetches).toBe(1);
    vi.setSystemTime(Date.now() + JWKS_MIN_REFETCH_MS + 1);
    for (let i = 0; i < 50; i++) await proveAccessToken(token("ES256", ec.privateKey, `again-${i}`), PROJECT);
    expect(jwksFetches).toBe(2);
  });

  it("a key published after the last fetch is picked up (key rotation), within the refetch limit", async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    keys = [EC_JWK];
    expect(await proveAccessToken(token("RS256", rsa.privateKey, "rsa-1"), PROJECT)).toEqual({ kind: "unverifiable" });
    keys = [EC_JWK, RSA_JWK];
    vi.setSystemTime(Date.now() + JWKS_MIN_REFETCH_MS + 1);
    expect(await proveAccessToken(token("RS256", rsa.privateKey, "rsa-1"), PROJECT)).toMatchObject({ kind: "verified" });
  });

  it("keys are fetched again after the TTL; if that fails, the cached ones are still used", async () => {
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date"] });
    expect(await proveAccessToken(token("ES256", ec.privateKey, "ec-1"), PROJECT)).toMatchObject({ kind: "verified" });
    vi.setSystemTime(Date.now() + JWKS_TTL_MS + 1);
    jwksReply = "network";
    expect(await proveAccessToken(token("ES256", ec.privateKey, "ec-1"), PROJECT)).toMatchObject({ kind: "verified" });
    expect(jwksFetches).toBe(2);
  });

  it("signed by the project's key but not a session of this project (wrong issuer, no session id): unverifiable", async () => {
    expect(await proveAccessToken(token("ES256", ec.privateKey, "ec-1", { ...claims, iss: "https://otherrefaaaaaaaaaaaa.supabase.co/auth/v1" }), PROJECT)).toEqual({ kind: "unverifiable" });
    expect(await proveAccessToken(token("ES256", ec.privateKey, "ec-1", { ...claims, session_id: undefined }), PROJECT)).toEqual({ kind: "unverifiable" });
  });
});
