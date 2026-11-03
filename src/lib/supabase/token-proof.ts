import "server-only";
import { clientIp, sessionKey, type Bucket } from "@/lib/ratelimit";

// Whether the access token in a session cookie was really issued by this project, checked HERE, before anything
// spends a shared budget or asks Supabase (M1, M2). A cookie is whatever the client sends: without this, a made-up
// one could use up the refresh budget every student shares, or make this server call /user without limit.
//
// Supabase signs access tokens with either
//   - an asymmetric signing key (RS256 or ES256), whose public half it publishes at /auth/v1/.well-known/jwks.json;
//   - or a shared secret (HS256: the legacy JWT secret, or an imported one), which is never published.
// These are the algorithms auth-js itself can check locally (2.118: getAlgorithm knows only RS256 and ES256; HS256 is
// always checked by asking /user). This app never holds the shared secret (it could mint any token), so:
//   verified      RS256/ES256, its key id is in the project's published keys, the signature is good, and it names
//                 this project as issuer, a user and a session. Expiry is NOT checked: an expiring token is exactly
//                 the one that gets refreshed, and the refresh token, not this one, is what Supabase checks then.
//   forged        Supabase never issued it: not a token at all, alg "none", or a published key whose signature fails
//                 (or that doesn't fit the algorithm the token claims).
//   unverifiable  Can't be told here: HS256, an algorithm auth-js doesn't support, a key id not (or no longer)
//                 published, or the keys couldn't be fetched. Real sessions end up here only on an HS256 project or
//                 just after a signing key is revoked; that's why accounts need asymmetric signing keys (S1.8).
// Each kind gets its own rate-limit buckets (below): forged cookies never reach Supabase, unverifiable ones share a
// small budget of their own, and only verified sessions can use the main refresh budget.

export type TokenProof = { kind: "verified"; userId: string; sessionId: string } | { kind: "forged" } | { kind: "unverifiable" };

/** How long fetched keys are used before being fetched again. */
export const JWKS_TTL_MS = 10 * 60_000;
/** Keys that couldn't be refreshed are still used (for checking only) for this long. */
export const JWKS_STALE_MAX_MS = 24 * 60 * 60_000;
/** At most one fetch per this long, whatever key ids requests name (an unknown kid can't make this server fetch). */
export const JWKS_MIN_REFETCH_MS = 60_000;
export const JWKS_TIMEOUT_MS = 1500;
/** Supabase's access tokens are a few hundred bytes to a couple of kilobytes. */
const MAX_TOKEN_CHARS = 16 * 1024;

const SEGMENT = /^[A-Za-z0-9_-]+$/;

type Jwk = JsonWebKey & { kid: string; alg?: string };
type Cache = { url: string; keys: Jwk[]; fetchedAt: number };

let cache: Cache | null = null;
let lastAttempt: { url: string; at: number } | null = null;
let inflight: Promise<void> | null = null;

/** For tests only. */
export function resetJwksCacheForTests() {
  cache = null;
  lastAttempt = null;
  inflight = null;
}

const decode = (segment: string): unknown => JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));

const ALGORITHMS = {
  RS256: { import: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, verify: { name: "RSASSA-PKCS1-v1_5" }, kty: "RSA" },
  ES256: { import: { name: "ECDSA", namedCurve: "P-256" }, verify: { name: "ECDSA", hash: "SHA-256" }, kty: "EC" },
} as const;
type Alg = keyof typeof ALGORITHMS;

async function fetchKeys(url: string, publishableKey: string, deadline?: AbortSignal): Promise<void> {
  lastAttempt = { url, at: Date.now() };
  try {
    const signal = AbortSignal.any([AbortSignal.timeout(JWKS_TIMEOUT_MS), ...(deadline ? [deadline] : [])]);
    const res = await fetch(`${url}/auth/v1/.well-known/jwks.json`, { headers: { apikey: publishableKey }, signal, cache: "no-store" });
    if (!res.ok) return;
    const body = (await res.json()) as { keys?: unknown } | null;
    if (!body || !Array.isArray(body.keys)) return;
    const keys = body.keys.filter((k): k is Jwk => !!k && typeof k === "object" && typeof (k as Jwk).kid === "string" && ((k as Jwk).kty === "RSA" || (k as Jwk).kty === "EC"));
    // An empty list is a real answer (an HS256-only project): cached like any other, so it isn't asked again and again.
    cache = { url, keys, fetchedAt: Date.now() };
  } catch {
    // Unreachable or unreadable: whatever is cached stays (see JWKS_STALE_MAX_MS).
  }
}

/** The published key with this id; null when it isn't known (or can't be fetched). Fetches at most once a minute. */
async function keyFor(kid: string, url: string, publishableKey: string, deadline?: AbortSignal): Promise<Jwk | null> {
  const now = Date.now();
  const current = cache?.url === url ? cache : null;
  const found = current?.keys.find((k) => k.kid === kid) ?? null;
  const fresh = !!current && now - current.fetchedAt < JWKS_TTL_MS;
  if (found && fresh) return found;
  const mayFetch = !lastAttempt || lastAttempt.url !== url || now - lastAttempt.at >= JWKS_MIN_REFETCH_MS;
  if (mayFetch || inflight) {
    inflight ??= fetchKeys(url, publishableKey, deadline).finally(() => (inflight = null));
    await inflight;
  }
  const after = cache?.url === url ? cache : null;
  if (!after || Date.now() - after.fetchedAt > JWKS_STALE_MAX_MS) return null;
  return after.keys.find((k) => k.kid === kid) ?? null;
}

/** Checks `token` (the access token from a session cookie) against the project's published keys. Never throws. */
export async function proveAccessToken(token: unknown, project: { url: string; publishableKey: string }, { deadline }: { deadline?: AbortSignal } = {}): Promise<TokenProof> {
  if (typeof token !== "string" || !token || token.length > MAX_TOKEN_CHARS) return { kind: "forged" };
  const parts = token.split(".");
  if (parts.length !== 3 || !parts.every((p) => SEGMENT.test(p))) return { kind: "forged" };
  let header: { alg?: unknown; kid?: unknown };
  let claims: { iss?: unknown; sub?: unknown; session_id?: unknown };
  try {
    header = decode(parts[0]) as typeof header;
    claims = decode(parts[1]) as typeof claims;
  } catch {
    return { kind: "forged" };
  }
  if (!header || typeof header !== "object" || !claims || typeof claims !== "object") return { kind: "forged" };
  if (typeof header.alg !== "string" || header.alg.toLowerCase() === "none") return { kind: "forged" };
  if (!(header.alg in ALGORITHMS) || typeof header.kid !== "string" || !header.kid) return { kind: "unverifiable" };

  const alg = ALGORITHMS[header.alg as Alg];
  const jwk = await keyFor(header.kid, project.url, project.publishableKey, deadline);
  if (!jwk) return { kind: "unverifiable" };
  // The published key decides the algorithm, never the token: a token claiming ES256 under an RSA key (or a key
  // published for another algorithm) is not one Supabase made.
  if (jwk.kty !== alg.kty || (jwk.alg !== undefined && jwk.alg !== header.alg)) return { kind: "forged" };
  let valid: boolean;
  try {
    // Only the public key material: nothing the published entry adds (key_ops, use, ext) can widen what it's used for.
    const material: JsonWebKey = jwk.kty === "RSA" ? { kty: "RSA", n: jwk.n, e: jwk.e } : { kty: "EC", crv: jwk.crv, x: jwk.x, y: jwk.y };
    const key = await crypto.subtle.importKey("jwk", material, alg.import, false, ["verify"]);
    valid = await crypto.subtle.verify(alg.verify, key, Buffer.from(parts[2], "base64url"), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  } catch {
    return { kind: "unverifiable" }; // a key this runtime can't use: not evidence either way
  }
  if (!valid) return { kind: "forged" };
  // Signed by this project's key. Claims that don't fit a session are odd, not forged: no special budget for them.
  if (claims.iss !== `${project.url}/auth/v1` || typeof claims.sub !== "string" || !claims.sub || typeof claims.session_id !== "string" || !claims.session_id) {
    return { kind: "unverifiable" };
  }
  return { kind: "verified", userId: claims.sub, sessionId: claims.session_id };
}

type Check = { bucket: Bucket; key: string };

/**
 * The rate-limit buckets for a request whose session auth-js may REFRESH (one POST /token from this server's IPs).
 * Only verified sessions reach the main budget, and each session only a few times per window.
 */
export function refreshChecks(proof: Exclude<TokenProof, { kind: "forged" }>, headers: Headers): Check[] {
  const ip = clientIp(headers);
  if (proof.kind === "verified") {
    return [
      { bucket: "session:ip", key: ip },
      { bucket: "session:sid", key: sessionKey(proof.sessionId) },
      { bucket: "session:global", key: "all" },
    ];
  }
  return [
    { bucket: "session:ip", key: ip },
    { bucket: "session:unverified", key: "all" },
  ];
}

/** The buckets for a request whose still-fresh session is only CHECKED (one call to /user or /logout). */
export function checkChecks(proof: Exclude<TokenProof, { kind: "forged" }>, headers: Headers): Check[] {
  if (proof.kind === "verified") return [{ bucket: "session-check:sid", key: sessionKey(proof.sessionId) }];
  return [
    { bucket: "session-check:ip", key: clientIp(headers) },
    { bucket: "session-check:unverified", key: "all" },
  ];
}
