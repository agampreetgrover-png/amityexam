import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECOVERY_COOKIE } from "@/lib/auth/recovery-marker";
import { CookieWrites, timing } from "@/lib/auth/route";
import { buildServerClient, callLogOf } from "@/lib/supabase/server";
import { sessionEvidence } from "@/lib/supabase/session-policy";
import { captchaToken, COOKIE, sessionBody, signedInCookies, SUPABASE_URL, USER_ID, type Reply } from "@/test/fake-supabase";
import { isDeletion, post, sessionIn, setCookies, setupAccounts, teardownAccounts, type Harness } from "@/test/auth-routes";
import { POST as forgot } from "./forgot/route";
import { POST as login } from "./login/route";
import { POST as resend } from "./resend/route";
import { POST as signup } from "./signup/route";
import { POST as updatePassword } from "./update-password/route";
import { POST as verify } from "./verify/route";

vi.mock("@/lib/supabase/projects", () => ({ SUPABASE_PROJECTS: { development: ["devrefaaaaaaaaaaaaaa"], production: [], local: [] } }));

// The routes that START a session (login, verify) or send an email (signup, resend, forgot).

const GOOD = "correct horse battery";
const err = (status: number, code: string, delayMs?: number): Reply => ({ status, body: { code, msg: code }, delayMs });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

let h: Harness;
beforeEach(() => (h = setupAccounts()));
afterEach(teardownAccounts);
const endpoints = () => h.server.calls.map((c) => c.endpoint);

describe("POST /auth/login", () => {
  const signIn = async (body: object = { email: "a@example.test", password: GOOD }, cookies: { name: string; value: string }[] = []) => {
    const res = await login(post("/auth/login", body, { cookies }));
    return { res, status: res.status, body: await res.json(), cookies: setCookies(res) };
  };

  it("signs in: { userId, email } from Supabase's answer, and the session cookie (HttpOnly, Lax, Path=/)", async () => {
    const s = sessionBody(3600);
    h.server.reply("password", { status: 200, body: s });
    // A user id in the request is ignored: only Supabase says who signed in.
    const r = await signIn({ email: " a@example.test ", password: GOOD, userId: "attacker-chosen" });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ userId: USER_ID, email: "a@example.test" });
    expect((await sessionIn(r.res))?.refresh_token).toBe(s.refresh_token);
    expect(r.cookies.get(COOKIE)).toMatch(/HttpOnly/i);
    expect(r.cookies.get(COOKIE)).toMatch(/SameSite=lax/i);
    expect(h.server.calls[0].body).toMatchObject({ email: "a@example.test", password: GOOD });
  });

  it("applies login:ip, then login:ip-email keyed by an HMAC of the address (never the address itself), then login:global", async () => {
    h.server.reply("password", { status: 200, body: sessionBody(3600) });
    await signIn({ email: "A@Example.test", password: GOOD });
    expect(h.store.checks.map((c) => c.bucket)).toEqual(["login:ip", "login:ip-email", "login:global"]);
    const key = h.store.checks[1].key;
    expect(key).toMatch(/^local:[0-9a-f]{64}$/);
    expect(key.toLowerCase()).not.toContain("example");
  });

  it("over a login limit → 429 rate_limited with Retry-After; Supabase never asked", async () => {
    for (const bucket of ["login:ip", "login:ip-email"] as const) {
      h.store.refuse.clear();
      h.store.refuse.add(bucket);
      const r = await signIn();
      expect(r.status).toBe(429);
      expect(r.body.error.code).toBe("rate_limited");
      expect(r.body.error.retryAfter).toBeGreaterThan(0);
      expect(Number(r.res.headers.get("retry-after"))).toBeGreaterThan(0);
    }
    expect(h.server.calls).toHaveLength(0);
  });

  for (const [why, reply, expected] of [
    ["a wrong password (invalid_credentials)", err(400, "invalid_credentials"), [400, "invalid_credentials"]],
    ["a wrong password, older Supabase without a code", { status: 400, body: { error: "invalid_grant", error_description: "Invalid login credentials" } }, [400, "invalid_credentials"]],
    ["an unconfirmed email", err(400, "email_not_confirmed"), [400, "email_not_confirmed"]],
    ["a banned account", err(403, "user_banned"), [403, "blocked"]],
    ["a refused captcha", err(400, "captcha_failed"), [403, "blocked"]],
    ["Supabase's own rate limit", err(429, "over_request_rate_limit"), [429, "rate_limited"]],
    ["Supabase down", { status: 503, body: {} }, [503, "unavailable"]],
    ["the network failing", "network", [503, "unavailable"]],
    ["a 200 without a session", { status: 200, body: {} }, [503, "unavailable"]],
  ] as const) {
    it(`${why} → ${expected[0]} ${expected[1]}, and no cookie is written`, async () => {
      h.server.reply("password", reply as Reply);
      const r = await signIn(undefined, await signedInCookies(3600));
      expect([r.status, r.body.error?.code]).toEqual(expected);
      expect(r.cookies.size).toBe(0); // the existing session (if any) is left exactly as it was
    });
  }

  for (const [why, body, field] of [
    ["no email", { password: GOOD }, "email"],
    ["a malformed email", { email: "not-an-email", password: GOOD }, "email"],
    ["a non-string email", { email: ["a@example.test"], password: GOOD }, "email"],
    ["an over-long email", { email: `${"a".repeat(250)}@example.test`, password: GOOD }, "email"],
    ["no password", { email: "a@example.test" }, "password"],
    ["an empty password", { email: "a@example.test", password: "" }, "password"],
    ["a non-string password", { email: "a@example.test", password: 1234567890 }, "password"],
    ["a huge password", { email: "a@example.test", password: "x".repeat(1025) }, "password"],
  ] as const) {
    it(`${why} → 400 invalid_input (${field}), without spending a limit or asking Supabase`, async () => {
      const r = await signIn(body);
      expect(r.body).toEqual({ error: { code: "invalid_input", field } });
      expect(h.store.checks).toHaveLength(0);
      expect(h.server.calls).toHaveLength(0);
    });
  }

  it("an old password shorter than today's policy can still sign in (the policy is for new passwords)", async () => {
    h.server.reply("password", { status: 200, body: sessionBody(3600) });
    expect((await signIn({ email: "a@example.test", password: "short" })).status).toBe(200);
  });

  it("checks the CAPTCHA itself and never passes the token on to Supabase (it works only once)", async () => {
    h.server.reply("password", { status: 200, body: sessionBody(3600) });
    expect((await signIn()).status).toBe(200);
    expect(h.server.captchaCalls).toEqual([{ token: captchaToken("login"), secret: "0x4AAAAAAAtest-secret" }]);
    expect(JSON.stringify(h.server.calls[0].body)).not.toContain("captcha");
  });

  it("replaces another account's session: its chunks the new session doesn't overwrite are deleted", async () => {
    const old = await signedInCookies(3600, "x".repeat(5000)); // a big session: chunks .0, .1, …
    expect(old.some((c) => c.name === `${COOKIE}.1`)).toBe(true);
    const s = sessionBody(3600);
    h.server.reply("password", { status: 200, body: s });
    const r = await signIn(undefined, old);
    for (const c of old) if (!r.cookies.get(c.name) || isDeletion(r.cookies.get(c.name))) expect(isDeletion(r.cookies.get(c.name))).toBe(true);
    expect((await sessionIn(r.res))?.refresh_token).toBe(s.refresh_token); // what the browser ends up with reads as the NEW session
  });
});

// The S1.2a concern: a client given the request's cookies starts refreshing a stale session as soon as it exists,
// and auth-js doesn't wait for that before signing in. Measured with auth-js 2.118 (the CONTROL below): the stale
// refresh still goes out (spending this server's shared /token budget) and its failure arrives AFTER the sign-in,
// so the call log would read it as evidence about the NEW session. auth-js itself keeps the new session in that run.
// The routes avoid all of it by signing in with a client that starts without cookies.
describe("the session race: a stale cookie's late refresh can't touch a new sign-in", () => {
  it("CONTROL (why the routes don't inherit cookies): the stale refresh is sent, and its late answer lands after the sign-in", async () => {
    h.server.reply("refresh", err(400, "refresh_token_not_found", 150)); // the stale session's refresh, answered late
    const fresh = sessionBody(3600);
    h.server.reply("password", { status: 200, body: fresh });
    const writes = new CookieWrites();
    const stale = await signedInCookies(-10);
    const inheriting = buildServerClient(SUPABASE_URL, "sb_publishable_test", writes.jar(stale), { https: false });
    const { error } = await inheriting.auth.signInWithPassword({ email: "a@example.test", password: GOOD });
    expect(error).toBeNull();
    await pause(300); // the late refresh answer arrives after the sign-in
    expect(endpoints()).toEqual(["password", "refresh"]); // a refresh of the OLD token went out anyway
    const log = callLogOf(inheriting)!;
    expect(log.calls.map((c) => c.endpoint)).toEqual(["sign-in", "refresh"]);
    // …so the old session's "gone for good" now sits where only answers about the new session should be:
    expect(sessionEvidence(log).map((c) => c.code)).toEqual(["refresh_token_not_found"]);
    expect((await sessionIn(writes.all(new NextResponse(null))))?.refresh_token).toBe(fresh.refresh_token); // auth-js kept it, this time
  });

  for (const [route, handler, body, script] of [
    ["/auth/login", login, { email: "a@example.test", password: GOOD }, () => h.server.reply("password", { status: 200, body: sessionBody(3600) })],
    ["/auth/verify", verify, { tokenHash: "a".repeat(56), type: "recovery", replaceSession: true }, () => h.server.reply("verify", { status: 200, body: sessionBody(3600, "", { amr: [{ method: "recovery", timestamp: Math.floor(Date.now() / 1000) }] }) })],
  ] as const) {
    it(`${route}: never refreshes the request's stale session, and the response holds the new session`, async () => {
      h.server.reply("refresh", err(400, "refresh_token_not_found", 50)); // would be the stale session's answer
      script();
      const stale = await signedInCookies(-10);
      const res = await handler(post(route, body, { cookies: stale }));
      await pause(150);
      expect(res.status).toBe(200);
      expect(endpoints()).not.toContain("refresh");
      expect(await sessionIn(res)).not.toBeNull();
      expect(isDeletion(setCookies(res).get(COOKIE))).toBe(false);
    });
  }
});

describe("POST /auth/verify", () => {
  const open = async (body: object, cookies: { name: string; value: string }[] = []) => {
    const res = await verify(post("/auth/verify", body, { cookies }));
    return { res, status: res.status, body: await res.json(), cookies: setCookies(res) };
  };
  const HASH = "0123456789abcdef".repeat(4);

  for (const type of ["signup", "email", "recovery"] as const) {
    it(`a ${type} link → { userId, email, type } and the link's session`, async () => {
      h.server.reply("verify", { status: 200, body: sessionBody(3600) });
      const r = await open({ tokenHash: HASH, type });
      expect(r.body).toEqual({ userId: USER_ID, email: "a@example.test", type });
      expect(await sessionIn(r.res)).not.toBeNull();
      expect(h.server.calls[0].body).toMatchObject({ token_hash: HASH, type });
      expect(h.store.checks.map((c) => c.bucket)).toEqual(["verify:ip", "verify:global"]);
      // Only a recovery link marks its session for setting a password (HttpOnly, Strict, only sent to /auth).
      const marker = r.cookies.get(RECOVERY_COOKIE);
      if (type === "recovery") {
        expect(marker).toMatch(/HttpOnly/i);
        expect(marker).toMatch(/SameSite=strict/i);
        expect(marker).toMatch(/Path=\/auth(;|$)/);
        expect(isDeletion(marker)).toBe(false);
      } else expect(marker).toBeUndefined();
    });
  }

  it("a non-recovery link clears an older recovery marker", async () => {
    h.server.reply("verify", { status: 200, body: sessionBody(3600) });
    const r = await open({ tokenHash: HASH, type: "signup" }, [{ name: RECOVERY_COOKIE, value: "old" }]);
    expect(isDeletion(r.cookies.get(RECOVERY_COOKIE))).toBe(true);
  });

  it("end to end: open a recovery link, then set a new password with what that response set", async () => {
    const s = sessionBody(3600, "", { session_id: "sess-from-link" });
    h.server.reply("verify", { status: 200, body: s });
    const opened = await open({ tokenHash: HASH, type: "recovery" });
    // The browser now holds exactly the cookies the verify response set.
    const jar = [...opened.res.headers.getSetCookie()].map((l) => l.split(";")[0]).map((p) => ({ name: p.slice(0, p.indexOf("=")), value: decodeURIComponent(p.slice(p.indexOf("=") + 1)) })).filter((c) => c.value);
    h.server.reply("user", { status: 200, body: { id: USER_ID, aud: "authenticated", email: "a@example.test" } });
    h.server.reply("logout", { status: 200, body: {} }, { status: 200, body: {} });
    h.server.reply("update-user", { status: 200, body: { id: USER_ID } });
    const res = await updatePassword(post("/auth/update-password", { password: "a brand new passphrase", expectedUserId: opened.body.userId }, { cookies: jar }));
    expect(res.status).toBe(200);
    expect(endpoints()).toEqual(["verify", "user", "logout", "update-user", "logout"]);
    // …and a signup confirmation link's session can't do the same.
    h.server.reply("verify", { status: 200, body: sessionBody(3600, "", { session_id: "sess-signup" }) });
    const confirmed = await open({ tokenHash: HASH, type: "signup" });
    const jar2 = [...confirmed.res.headers.getSetCookie()].map((l) => l.split(";")[0]).map((p) => ({ name: p.slice(0, p.indexOf("=")), value: decodeURIComponent(p.slice(p.indexOf("=") + 1)) })).filter((c) => c.value);
    h.server.reply("user", { status: 200, body: { id: USER_ID, aud: "authenticated", email: "a@example.test" } });
    const refused = await updatePassword(post("/auth/update-password", { password: "a brand new passphrase", expectedUserId: USER_ID }, { cookies: jar2 }));
    expect(refused.status).toBe(401);
  });

  for (const [why, reply, expected] of [
    ["used or expired (otp_expired)", err(403, "otp_expired"), [400, "link_expired"]],
    ["unknown to Supabase", err(404, "not_found"), [400, "link_invalid"]],
    ["refused for another reason", err(400, "validation_failed"), [400, "link_invalid"]],
    ["rate limited by Supabase", err(429, "over_request_rate_limit"), [429, "rate_limited"]],
    ["Supabase down", { status: 503, body: {} }, [503, "unavailable"]],
    ["answered without a session", { status: 200, body: { user: { id: USER_ID } } }, [503, "unavailable"]],
  ] as const) {
    it(`a link ${why} → ${expected[1]}, no cookie written`, async () => {
      h.server.reply("verify", reply as Reply);
      // Over an existing session (the switch confirmed): a failed link changes nothing, and revokes nothing.
      const r = await open({ tokenHash: HASH, type: "signup", replaceSession: true }, await signedInCookies(3600));
      expect([r.status, r.body.error?.code]).toEqual(expected);
      expect(endpoints()).not.toContain("logout");
      expect(r.cookies.size).toBe(0);
    });
  }

  for (const [why, body] of [
    ["no token", { type: "signup" }],
    ["a short token", { tokenHash: "abc", type: "signup" }],
    ["a token with odd characters", { tokenHash: "abcd efgh<script>", type: "signup" }],
    ["a huge token", { tokenHash: "a".repeat(513), type: "signup" }],
    ["an unknown type", { tokenHash: HASH, type: "magiclink" }],
    ["no type", { tokenHash: HASH }],
  ] as const) {
    it(`${why} → 400 link_invalid without asking Supabase`, async () => {
      expect((await open(body)).body).toEqual({ error: { code: "link_invalid" } });
      expect(h.server.calls).toHaveLength(0);
    });
  }

  it("over the verify limit → 429", async () => {
    h.store.refuse.add("verify:ip");
    expect((await open({ tokenHash: HASH, type: "signup" })).status).toBe(429);
    expect(h.server.calls).toHaveLength(0);
  });
});

// Sign-up, resend and forgot: whether an address has an account must not show, in the answer or its timing.
describe("email privacy: POST /auth/signup", () => {
  const send = async (body: object = { email: "a@example.test", password: GOOD }) => {
    const res = await signup(post("/auth/signup", body));
    return { status: res.status, body: await res.json(), cookies: setCookies(res).size };
  };
  const NEW = { status: 200, body: { id: USER_ID, email: "a@example.test", identities: [{ id: "i" }] } };
  const EXISTING_HIDDEN = { status: 200, body: { id: "fake", email: "a@example.test", identities: [] } }; // Supabase's obfuscated answer
  const EXISTING_ERROR = err(422, "user_already_exists");
  const EMAIL_LIMIT = err(429, "over_email_send_rate_limit");

  it("a new address, an existing one (either way Supabase says so) and Supabase's email limit all answer the same {}", async () => {
    const answers = [];
    for (const reply of [NEW, EXISTING_HIDDEN, EXISTING_ERROR, EMAIL_LIMIT, err(400, "email_exists")]) {
      h.server.reply("signup", reply);
      answers.push(await send());
    }
    for (const a of answers) expect(a).toEqual({ status: 200, body: {}, cookies: 0 });
  });

  it("Supabase failing or unreachable also reads as {} (a confirmation email is sent only for new addresses)", async () => {
    for (const reply of [{ status: 500, body: { code: "unexpected_failure" } }, { status: 503, body: {} }, "network" as const]) {
      h.server.reply("signup", reply);
      expect(await send()).toEqual({ status: 200, body: {}, cookies: 0 });
    }
  });

  it("never sets a cookie, even if Supabase hands back a session (auto-confirm on)", async () => {
    h.server.reply("signup", { status: 200, body: sessionBody(3600) });
    expect(await send()).toEqual({ status: 200, body: {}, cookies: 0 });
  });

  it("every answer after the limits waits out the same minimum time", async () => {
    timing.privacyFloorMs = 120;
    for (const reply of [NEW, EXISTING_ERROR]) {
      h.server.reply("signup", reply);
      const started = Date.now();
      await send();
      expect(Date.now() - started).toBeGreaterThanOrEqual(115);
    }
  });

  it("the password policy, before anything else: too short → 422 weak_password; over 72 bytes → 400 invalid_input", async () => {
    expect((await send({ email: "a@example.test", password: "ninechars" })).body).toEqual({ error: { code: "weak_password", field: "password" } });
    expect((await send({ email: "a@example.test", password: "x".repeat(73) })).body).toEqual({ error: { code: "invalid_input", field: "password" } });
    expect((await send({ email: "a@example.test", password: "" })).body).toEqual({ error: { code: "invalid_input", field: "password" } });
    expect((await send({ email: "bad", password: GOOD })).body).toEqual({ error: { code: "invalid_input", field: "email" } });
    expect(h.server.calls).toHaveLength(0);
    expect(h.store.checks).toHaveLength(0);
  });

  it("passwords are not composition-checked: ten lowercase letters pass, and paste-length 72 bytes pass", async () => {
    h.server.reply("signup", NEW, NEW);
    expect((await send({ email: "a@example.test", password: "aaaaaaaaaa" })).status).toBe(200);
    expect((await send({ email: "a@example.test", password: "x".repeat(72) })).status).toBe(200);
  });

  for (const [why, reply, expected] of [
    ["Supabase's own password check (weak_password)", err(422, "weak_password"), [422, "weak_password"]],
    ["a refused captcha", err(400, "captcha_failed"), [403, "blocked"]],
    ["an address Supabase won't take", err(400, "email_address_invalid"), [400, "invalid_input"]],
    ["sign-ups switched off in the project", err(422, "signup_disabled"), [404, "disabled"]],
  ] as const) {
    it(`${why} → ${expected[1]}`, async () => {
      h.server.reply("signup", reply as Reply);
      const r = await send();
      expect([r.status, r.body.error?.code]).toEqual(expected);
    });
  }

  it("applies signup:ip then signup:email (HMAC); over either → 429, Supabase never asked", async () => {
    h.server.reply("signup", NEW);
    await send();
    expect(h.store.checks.map((c) => c.bucket)).toEqual(["signup:ip", "signup:email", "email:global"]);
    expect(h.store.checks[1].key).toMatch(/^[0-9a-f]{64}$/);
    h.store.refuse.add("signup:email");
    expect((await send()).status).toBe(429);
    expect(endpoints()).toEqual(["signup"]);
  });
});

describe.each([
  ["/auth/resend", resend, "resend", ["resend:ip", "resend:email", "email:global"]],
  ["/auth/forgot", forgot, "recover", ["forgot:ip", "forgot:email", "email:global"]],
] as const)("email privacy: POST %s", (path, handler, endpoint, buckets) => {
  const send = async (body: object = { email: "a@example.test" }, headers: Record<string, string> = {}) => {
    const res = await handler(post(path, body, { headers }));
    return { status: res.status, body: await res.json(), cookies: setCookies(res).size };
  };

  it("an address with an account, one without, one already confirmed and Supabase's email limit: the same {}", async () => {
    const answers = [];
    for (const reply of [{ status: 200, body: {} }, err(404, "user_not_found"), err(422, "email_address_not_authorized"), err(400, "validation_failed_other"), err(429, "over_email_send_rate_limit")]) {
      h.server.reply(endpoint, reply);
      answers.push(await send());
    }
    for (const a of answers) expect(a).toEqual({ status: 200, body: {}, cookies: 0 });
  });

  it("waits out the same minimum time whatever Supabase answered", async () => {
    timing.privacyFloorMs = 120;
    for (const reply of [{ status: 200, body: {} }, err(404, "user_not_found")]) {
      h.server.reply(endpoint, reply);
      const started = Date.now();
      await send();
      expect(Date.now() - started).toBeGreaterThanOrEqual(115);
    }
  });

  it("Supabase failing, unreachable or past the deadline also reads as {} (sending happens only for some addresses)", async () => {
    for (const reply of [{ status: 500, body: { code: "unexpected_failure" } }, { status: 503, body: {} }, "network" as const]) {
      h.server.reply(endpoint, reply);
      expect(await send()).toEqual({ status: 200, body: {}, cookies: 0 });
    }
  });

  it("reports only what doesn't depend on the address: a bad address, a refused captcha", async () => {
    expect((await send({ email: "nope" })).body).toEqual({ error: { code: "invalid_input", field: "email" } });
    h.server.reply(endpoint, err(400, "captcha_failed"));
    expect((await send()).body).toEqual({ error: { code: "blocked" } });
  });

  it(`applies ${buckets.join(" then ")}; over any → 429 with Retry-After`, async () => {
    h.server.reply(endpoint, { status: 200, body: {} });
    await send();
    expect(h.store.checks.map((c) => c.bucket)).toEqual(buckets);
    h.store.refuse.add(buckets[0]);
    const r = await send();
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe("rate_limited");
    expect(endpoints()).toEqual([endpoint]); // the refused request never reached Supabase
  });

  it("checks the CAPTCHA itself (never passed on), reads no cookie and writes none", async () => {
    h.server.reply(endpoint, { status: 200, body: {} });
    const res = await handler(post(path, { email: "a@example.test" }, { cookies: await signedInCookies(-10) }));
    expect(setCookies(res).size).toBe(0);
    expect(endpoints()).toEqual([endpoint]); // the request's stale session was not refreshed
    expect(h.server.captchaCalls).toHaveLength(1);
    expect(JSON.stringify(h.server.calls[0].body)).not.toContain("captcha");
  });

  it("never builds a link from the request's Host (no redirect_to, even with a forged forwarded host)", async () => {
    h.server.reply(endpoint, { status: 200, body: {} });
    await send(undefined, { "x-forwarded-host": "evil.example" });
    const url = new URL(h.server.calls[0].url);
    expect(url.searchParams.get("redirect_to")).toBeNull();
    expect(JSON.stringify(h.server.calls[0].body)).not.toContain("evil.example");
  });
});
