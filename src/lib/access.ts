// Optional password for a deployed copy (APP_PASSWORD). Shared by the middleware and /unlock; Web Crypto only,
// so it runs in the middleware's edge runtime too. The cookie holds an HMAC of the password, never the password:
// changing APP_PASSWORD signs everyone out.

export const SESSION_COOKIE = "amityexams_session";
export const SESSION_MAX_AGE = 400 * 24 * 60 * 60; // the longest browsers keep a cookie

export const appPassword = () => process.env.APP_PASSWORD || "";

async function hmac(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Compares in time independent of where the strings first differ. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const sessionToken = (password: string) => hmac(password, "amityexams-session-v1");

export async function isValidSession(cookie: string | undefined): Promise<boolean> {
  const pw = appPassword();
  return !!pw && !!cookie && safeEqual(cookie, await sessionToken(pw));
}

/** Both sides are hashed first so the comparison doesn't leak the password's length. */
export async function passwordMatches(given: string): Promise<boolean> {
  const pw = appPassword();
  return !!pw && safeEqual(await hmac("amityexams-pw", given), await hmac("amityexams-pw", pw));
}
