// Headless Chrome check of the account screens against a running build, with every /auth/* answer mocked (the
// backend routes don't exist yet). Start the app first (npm run build && npx next start -p 3200), then:
//   node scripts/auth-ui-check.mjs [--base http://127.0.0.1:3200] [--out dir] [--no-shots]
// Each scenario sets the mocked answers, visits a screen, acts like a student (types, clicks) and asserts what the
// screen shows and which requests it made. Screenshots at 390 and 1440 wide, light and dark; axe-core runs on each
// state. Chrome uses a throwaway profile, so no real browser data is touched. Exit 1 if any assertion fails.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const BASE = opt("base", "http://127.0.0.1:3200");
const OUT = opt("out", join(tmpdir(), "amityexams-auth-ui-check"));
const SHOTS = !args.includes("--no-shots");
const CHROME = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome"].find((p) => p && existsSync(p));
if (!CHROME) throw new Error("No Chrome/Edge found; set CHROME_PATH.");
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profileDir = mkdtempSync(join(tmpdir(), "amityexams-auth-chrome-"));
const port = 9700 + Math.floor(Math.random() * 200);
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "--no-first-run", "about:blank"], { stdio: "ignore" });

let ws;
for (let i = 0; i < 60 && !ws; i++) {
  try {
    const page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
    if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
  } catch {}
  if (!ws) await sleep(200);
}
if (!ws) throw new Error("Chrome didn't start.");
await new Promise((r) => ws.addEventListener("open", r));

let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(`page threw: ${r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text}`);
  return r.result?.result?.value;
};

// ── Mocked /auth/* answers ──────────────────────────────────────────────────────────────────────────────────────
// mocks: { "<METHOD> <path>": { status, body, delay } | [ …in order… ] }. Anything under /auth/ not listed goes to
// the real server (which today answers 404 for every /auth route, i.e. "accounts not available").
let mocks = {};
let requests = [];
let pageErrors = [];
ws.addEventListener("message", async (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) return pending.get(msg.id)(msg), pending.delete(msg.id);
  if (msg.method === "Runtime.exceptionThrown") pageErrors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") pageErrors.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  if (msg.method === "Fetch.requestPaused") {
    const { request, requestId } = msg.params;
    const url = new URL(request.url);
    requests.push({ method: request.method, path: url.pathname, body: request.postData ?? null });
    const key = `${request.method} ${url.pathname}`;
    let mock = mocks[key];
    if (Array.isArray(mock)) mock = mock.length > 1 ? mock.shift() : mock[0];
    if (!mock) return send("Fetch.continueRequest", { requestId });
    if (mock.delay) await sleep(mock.delay);
    const headers = [{ name: "Content-Type", value: "application/json" }, { name: "Cache-Control", value: "no-store" }, ...Object.entries(mock.headers ?? {}).map(([name, value]) => ({ name, value }))];
    send("Fetch.fulfillRequest", { requestId, responseCode: mock.status ?? 200, responseHeaders: headers, body: Buffer.from(JSON.stringify(mock.body ?? {})).toString("base64") });
  }
});

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Network.setBypassServiceWorker", { bypass: true });
await send("Fetch.enable", { patterns: [{ urlPattern: "*/auth/*", requestStage: "Request" }] });

const settle = async (ms = 700) => {
  await sleep(250);
  for (let i = 0; i < 20 && (await evaluate("document.readyState")) !== "complete"; i++) await sleep(150);
  await sleep(ms);
};
const go = async (path, { storage } = {}) => {
  // Same origin first, so localStorage can be set before the screen reads it.
  if (storage) {
    await send("Page.navigate", { url: `${BASE}/manifest.webmanifest` }); // same origin, and opens no database
    await settle(200);
    await evaluate(`(() => { localStorage.clear(); sessionStorage.clear(); ${Object.entries(storage).map(([k, v]) => `${k.startsWith("session:") ? "sessionStorage" : "localStorage"}.setItem(${JSON.stringify(k.replace(/^session:/, ""))}, ${JSON.stringify(v)});`).join("")} })()`);
  }
  requests = [];
  pageErrors = [];
  await send("Page.navigate", { url: `${BASE}${path}` });
  await settle();
};
const text = () => evaluate("document.querySelector('main')?.innerText ?? document.body.innerText");
const h1 = () => evaluate("document.querySelector('h1')?.innerText.trim() ?? ''");
const typeInto = (label, value) =>
  evaluate(`(() => {
    const l = [...document.querySelectorAll('label')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
    const el = l && document.getElementById(l.htmlFor);
    if (!el) throw new Error('no field ' + ${JSON.stringify(label)});
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
const click = async (name) => {
  const ok = await evaluate(`(() => {
    const el = [...document.querySelectorAll('button, a')].find((x) => x.innerText.trim() === ${JSON.stringify(name)} || x.getAttribute('aria-label') === ${JSON.stringify(name)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!ok) throw new Error(`no button or link "${name}"`);
  await sleep(150);
};
const focusedLabel = () => evaluate(`(() => { const a = document.activeElement; const l = a && a.id && document.querySelector('label[for="' + CSS.escape(a.id) + '"]'); return l ? l.textContent.trim() : (a?.innerText || a?.tagName || ''); })()`);

// ── Recording ────────────────────────────────────────────────────────────────────────────────────────────────
const results = [];
let current = "";
const check = (name, ok, detail = "") => {
  results.push({ scenario: current, name, ok: !!ok, detail: ok ? "" : detail });
  console.log(`${ok ? "  ok  " : "  FAIL"} ${current}: ${name}${ok ? "" : ` (${detail})`}`);
};
const axeSource = readFileSync(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
const axeFindings = [];
const shot = async (label) => {
  await evaluate(axeSource);
  const v = await evaluate(`axe.run(document, { resultTypes: ['violations'] }).then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(' ') })))`);
  for (const x of v ?? []) axeFindings.push({ state: label, ...x });
  if (!SHOTS) return;
  for (const scheme of ["light", "dark"]) {
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
    for (const width of [390, 1440]) {
      await send("Emulation.setDeviceMetricsOverride", { width, height: width < 768 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 768 });
      await sleep(250);
      const overflow = await evaluate("document.documentElement.scrollWidth > window.innerWidth + 1");
      if (overflow) check(`no sideways scroll at ${width}px (${label})`, false, "page is wider than the viewport");
      const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      writeFileSync(join(OUT, `${label}-${width}-${scheme}.png`), Buffer.from(s.result.data, "base64"));
    }
  }
  await send("Emulation.setEmulatedMedia", { features: [] });
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(150);
};
const scenario = async (name, fn) => {
  current = name;
  mocks = {};
  try {
    await fn();
  } catch (e) {
    check("ran without error", false, e.message);
  }
  if (pageErrors.length) check("no page errors", false, pageErrors.slice(0, 3).join(" | "));
};

const USER = "0f8fad5b-d9cb-469f-a165-70867728950e";
const OTHER = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const SIGNED_OUT = { "GET /auth/session": { body: { state: "signed-out", reason: "none" } } };
const VERIFIED = { "GET /auth/session": { body: { state: "verified", user: { id: USER, email: "riya.sharma@s.amity.edu", emailVerified: true }, verifiedAt: "2026-11-01T10:00:00Z" } } };
const posts = (path) => requests.filter((r) => r.method === "POST" && r.path === path);
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

// ── Scenarios ───────────────────────────────────────────────────────────────────────────────────────────────
await scenario("accounts off (today's real server: no /auth routes)", async () => {
  await go("/login", { storage: {} });
  check("says accounts aren't available", (await h1()) === "Accounts aren't available here", await h1());
  check("no form is shown", !(await evaluate("!!document.querySelector('form')")));
  await shot("login-accounts-off");
});

await scenario("sign in: validation, server error, loading, success", async () => {
  mocks = { ...SIGNED_OUT };
  await go("/login", { storage: {} });
  check("form is ready once the server answered", await evaluate("!document.querySelector('fieldset').disabled"));
  await shot("login-form");
  await click("Sign in");
  await sleep(200);
  check("empty submit marks both fields", (await evaluate("document.querySelectorAll('[aria-invalid=true]').length")) === 2);
  check("focus moves to the first wrong field", (await focusedLabel()) === "Email", await focusedLabel());
  check("nothing was sent", posts("/auth/login").length === 0);
  await shot("login-validation");
  mocks["POST /auth/login"] = { status: 401, body: { error: { code: "invalid_credentials" } } };
  await typeInto("Email", "riya.sharma@s.amity.edu");
  await typeInto("Password", "wrong password here");
  await click("Sign in");
  await sleep(500);
  check("wrong password shows the server's error as an alert", (await evaluate("document.querySelector('[role=alert]')?.innerText ?? ''")).includes("don't match"));
  await shot("login-error");
  await click("Show password");
  check("show/hide toggles the field and its pressed state", (await evaluate("document.querySelector('input[name=password]').type")) === "text" && (await evaluate("document.querySelector('[aria-label=\"Show password\"]')?.getAttribute('aria-pressed')")) === "true");
  mocks["POST /auth/login"] = { delay: 1500, body: { userId: USER, email: "riya.sharma@s.amity.edu" } };
  await click("Sign in");
  await sleep(300);
  check("while signing in the button says so and can't be pressed", (await evaluate("(() => { const b = document.querySelector('button[type=submit]'); return b.getAttribute('aria-disabled') === 'true' && b.innerText.includes('Signing in'); })()")));
  await shot("login-loading");
  await sleep(1800);
  check("after signing in it goes to the switch screen (asks before opening data)", (await evaluate("location.pathname")) === "/switch", await evaluate("location.pathname"));
  check("the password was sent only in the POST body", requests.filter((r) => (r.body ?? "").includes("wrong password here")).every((r) => r.method === "POST" && r.path === "/auth/login"));
});

await scenario("sign in: email not confirmed, rate limited, ?reason notice", async () => {
  mocks = { ...SIGNED_OUT, "POST /auth/login": { status: 403, body: { error: { code: "email_not_confirmed" } } } };
  await go("/login?reason=expired", { storage: {} });
  check("explains the session expired", (await text()).includes("Your session expired"));
  await typeInto("Email", "riya.sharma@s.amity.edu");
  await typeInto("Password", "a long enough password");
  await click("Sign in");
  await sleep(500);
  check("offers to send the confirmation link again", (await text()).includes("Send the confirmation link again"));
  await shot("login-not-confirmed");
  mocks["POST /auth/login"] = { status: 429, body: { error: { code: "rate_limited" } }, headers: { "Retry-After": "120" } };
  await click("Sign in");
  await sleep(500);
  check("rate limit says how long to wait", (await text()).includes("Try again in 2 minutes"), await text());
});

await scenario("service unavailable, then offline, then back", async () => {
  mocks = { "GET /auth/session": { body: { state: "unavailable" } } };
  await go("/login", { storage: {} });
  check("unavailable screen", (await h1()) === "Sign-in isn't answering", await h1());
  await shot("login-unavailable");
  await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await click("Try again");
  await sleep(500);
  check("offline screen", (await h1()) === "You're offline", await h1());
  await shot("login-offline");
  mocks = { ...SIGNED_OUT };
  await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(1200);
  check("asks again by itself when the connection returns", (await h1()) === "Sign in", await h1());
});

await scenario("sign up: requirements, mismatch, success", async () => {
  mocks = { ...SIGNED_OUT, "POST /auth/signup": { delay: 800, body: {} } };
  await go("/signup", { storage: {} });
  await shot("signup-form");
  await typeInto("Email", "riya.sharma@s.amity.edu");
  await typeInto("Password", "short");
  check("live requirement line counts down", (await text()).includes("5 more characters to go"), await text());
  await typeInto("Password", "correct horse battery");
  await typeInto("Confirm password", "correct horse batterx");
  await click("Create account");
  await sleep(200);
  check("mismatch is reported on the confirm field", (await text()).includes("The passwords don't match"));
  check("nothing was sent", posts("/auth/signup").length === 0);
  await shot("signup-mismatch");
  await typeInto("Confirm password", "correct horse battery");
  await click("Create account");
  await sleep(200);
  await shot("signup-loading");
  await sleep(1200);
  check("goes to check-email", (await evaluate("location.pathname")) === "/check-email", await evaluate("location.pathname"));
  check("shows the address", (await text()).includes("riya.sharma@s.amity.edu"));
  check("password not in sessionStorage or localStorage", !(await evaluate("JSON.stringify({...localStorage, ...sessionStorage}).includes('correct horse')")));
});

await scenario("check email: resend and cooldown", async () => {
  mocks = { ...SIGNED_OUT, "POST /auth/resend": { delay: 500, body: {} } };
  await go("/check-email", { storage: { "session:amityexams:pending-email": "riya.sharma@s.amity.edu" } });
  await shot("check-email");
  // Straight from sign-up an email was just sent, so the button starts out waiting. Send from the form instead.
  await go("/check-email", { storage: {} });
  await typeInto("Email", "riya.sharma@s.amity.edu");
  await click(await evaluate("document.querySelector('button[type=submit]').innerText.trim()"));
  await sleep(900);
  check("resend request was sent once", posts("/auth/resend").length === 1);
  check("button waits before it can send again", await evaluate("[...document.querySelectorAll('button')].some((b) => b.disabled && /again in/i.test(b.innerText))"));
  await shot("check-email-cooldown");
});

await scenario("forgot password: generic answer", async () => {
  mocks = { ...SIGNED_OUT, "POST /auth/forgot": { body: {} } };
  await go("/forgot-password", { storage: {} });
  await shot("forgot-form");
  await typeInto("Email", "nobody@s.amity.edu");
  const send1 = await evaluate("document.querySelector('button[type=submit]').innerText.trim()");
  await click(send1);
  await sleep(600);
  const t = await text();
  check("success names the address without saying whether it exists", t.includes("If an account uses nobody@s.amity.edu"), t);
  await shot("forgot-sent");
});

await scenario("confirmation link: nothing used on open", async () => {
  mocks = { "POST /auth/verify": { delay: 600, body: { userId: USER, email: "riya.sharma@s.amity.edu", type: "signup" } } };
  await go("/auth/confirm?token_hash=pkce_abc123DEF&type=signup", { storage: {} });
  const apiCalls = requests.filter((r) => ["/auth/verify", "/auth/session"].includes(r.path) || r.method === "POST");
  check("opening the link sends nothing (no verify, no session check)", apiCalls.length === 0, JSON.stringify(apiCalls));
  check("the token is removed from the address bar", (await evaluate("location.search")) === "", await evaluate("location.href"));
  await shot("confirm-ready");
  await click(await evaluate("document.querySelector('button[type=submit]').innerText.trim()"));
  await sleep(200);
  await shot("confirm-loading");
  await sleep(900);
  check("verify was sent once with the token", posts("/auth/verify").length === 1 && (posts("/auth/verify")[0].body ?? "").includes("pkce_abc123DEF"));
  check("confirmed screen", (await h1()) === "Email confirmed", await h1());
  await shot("confirm-done");
});

await scenario("confirmation link: bad and expired", async () => {
  await go("/auth/confirm?token_hash=%3Cscript%3E&type=signup", { storage: {} });
  check("bad link screen", (await h1()) === "This link doesn't work", await h1());
  await shot("confirm-invalid");
  mocks = { "POST /auth/verify": { status: 400, body: { error: { code: "link_expired" } } } };
  await go("/auth/confirm?token_hash=abc123&type=recovery", { storage: {} });
  await click(await evaluate("document.querySelector('button[type=submit]').innerText.trim()"));
  await sleep(600);
  check("expired link screen", (await h1()) === "This link has expired", await h1());
  await shot("confirm-expired");
});

await scenario("reset password", async () => {
  mocks = { ...VERIFIED, "POST /auth/update-password": { delay: 600, body: {} } };
  await go("/reset-password", { storage: {} });
  await shot("reset-form");
  await typeInto("New password", "a brand new password");
  await typeInto("Confirm new password", "a brand new passwork");
  await click(await evaluate("document.querySelector('button[type=submit]').innerText.trim()"));
  await sleep(200);
  check("mismatch caught before sending", posts("/auth/update-password").length === 0 && (await text()).includes("don't match"));
  await typeInto("Confirm new password", "a brand new password");
  await click(await evaluate("document.querySelector('button[type=submit]').innerText.trim()"));
  await sleep(900);
  const body = posts("/auth/update-password")[0]?.body ?? "";
  check("sends the expected user id with the new password", body.includes(USER));
  check("success state", (await h1()) === "Password changed", await h1());
  await shot("reset-done");
  mocks = { ...SIGNED_OUT };
  await go("/reset-password", { storage: {} });
  check("without a recovery session it says the link expired", (await h1()) === "This link has expired", await h1());
});

await scenario("switch: asks before opening, never switches by itself", async () => {
  mocks = { ...VERIFIED };
  await go("/switch", { storage: { "amityexams:profile": "local" } });
  await sleep(500);
  check("still in Local Mode until a button is pressed", (await evaluate("localStorage.getItem('amityexams:profile')")) === "local");
  check("still on /switch", (await evaluate("location.pathname")) === "/switch");
  const t = await text();
  check("names both profiles", t.includes("Local Mode") && t.includes("riya.sharma@s.amity.edu"), t);
  check("says nothing is uploaded or merged and there is no sync", /upload|cop(y|ied)/i.test(t) && /sync/i.test(t), t);
  await shot("switch-from-local");
  const primary = await evaluate("[...document.querySelectorAll('button')].find((b) => /^Open /.test(b.innerText.trim()))?.innerText.trim()");
  await click(primary);
  await sleep(800);
  check("pressing Open stores the account profile", (await evaluate("localStorage.getItem('amityexams:profile')")) === `u:${USER}`);
  mocks = { ...VERIFIED };
  await go("/switch", { storage: { "amityexams:profile": `u:${OTHER}` } });
  await sleep(500);
  check("from another account: still that account until pressed", (await evaluate("localStorage.getItem('amityexams:profile')")) === `u:${OTHER}`);
  await shot("switch-from-other-account");
  mocks = { ...SIGNED_OUT };
  await go("/switch", { storage: { "amityexams:profile": `u:${USER}` } });
  await sleep(500);
  check("signed out: shows the signed-out screen", (await h1()) === "You're signed out", await h1());
  check("signed out: does NOT fall back to Local Mode", (await evaluate("localStorage.getItem('amityexams:profile')")) === `u:${USER}` && (await evaluate("location.pathname")) === "/switch");
  await shot("switch-signed-out");
});

await scenario("already signed in on /login", async () => {
  mocks = { ...VERIFIED };
  await go("/login", { storage: {} });
  check("offers to open the account or sign out", (await h1()) === "You're already signed in", await h1());
  await shot("login-already-signed-in");
});

await scenario("busy button stays focusable and ignores a second press", async () => {
  mocks = { ...SIGNED_OUT, "POST /auth/login": { delay: 1500, body: { userId: USER, email: "riya.sharma@s.amity.edu" } } };
  await go("/login", { storage: {} });
  await typeInto("Email", "riya.sharma@s.amity.edu");
  await typeInto("Password", "a long enough password");
  await evaluate("document.querySelector('button[type=submit]').focus()");
  await click("Sign in");
  await sleep(200);
  await click("Signing in…");
  await sleep(200);
  check("focus stays on the button while it works", (await evaluate("document.activeElement?.getAttribute('type')")) === "submit");
  check("a second press while busy sends nothing more", posts("/auth/login").length === 1, String(posts("/auth/login").length));
  await sleep(1600);
});

await scenario("server-side sign-out reasons", async () => {
  mocks = { "GET /auth/session": { body: { state: "signed-out", reason: "deleted" } } };
  await go("/switch", { storage: { "amityexams:profile": `u:${USER}` } });
  await sleep(400);
  check("a deleted account is called unavailable, not 'signed out'", (await h1()) === "This account isn't available", await h1());
  await shot("switch-account-unavailable");
  mocks = { "GET /auth/session": { body: { state: "signed-out", reason: "none" } } };
  await go("/switch", { storage: { "amityexams:profile": "local" } });
  await sleep(400);
  check("someone in Local Mode who never signed in isn't told they were signed out", (await h1()) === "No account is signed in", await h1());
  mocks = { "GET /auth/session": { body: { state: "signed-out", reason: "expired" } } };
  await go("/login", { storage: {} });
  check("/login explains an expired session from the server's reason", (await text()).includes("Your session expired"));
});

await scenario("more failure paths", async () => {
  mocks = { ...SIGNED_OUT, "POST /auth/forgot": { status: 429, body: { error: { code: "rate_limited", retryAfter: 30 } } } };
  await go("/forgot-password", { storage: {} });
  await typeInto("Email", "riya.sharma@s.amity.edu");
  await click(await evaluate("document.querySelector('button[type=submit]').innerText.trim()"));
  await sleep(500);
  check("forgot: a rate limit is shown, not the generic 'sent'", (await text()).includes("Try again in 30 seconds"), await text());

  mocks = { ...SIGNED_OUT, "POST /auth/signup": { status: 400, body: { error: { code: "invalid_input", field: "email" } } } };
  await go("/signup", { storage: {} });
  await typeInto("Email", "riya.sharma@s.amity.edu");
  await typeInto("Password", "correct horse battery");
  await typeInto("Confirm password", "correct horse battery");
  await click("Create account");
  await sleep(500);
  check(
    "sign-up: a server field error marks the field and moves focus to it",
    (await focusedLabel()) === "Email" && (await evaluate("document.querySelector('input[name=email]')?.getAttribute('aria-invalid')")) === "true",
    await focusedLabel(),
  );

  mocks = { ...VERIFIED, "POST /auth/update-password": { status: 422, body: { error: { code: "weak_password" } } } };
  await go("/reset-password", { storage: {} });
  await typeInto("New password", "password12");
  await typeInto("Confirm new password", "password12");
  await click(await evaluate("document.querySelector('button[type=submit]').innerText.trim()"));
  await sleep(500);
  check(
    "reset: a refused password is explained once, under the field",
    (await evaluate("document.querySelectorAll('[role=alert]').length")) === 0 && (await evaluate("document.querySelector('input[aria-invalid=true]') !== null")),
  );

  mocks = { ...SIGNED_OUT, "POST /auth/resend": { body: {} } };
  await go("/check-email", { storage: {} });
  check("check-email without a stored address asks for it", await evaluate("!!document.querySelector('input[type=email]')"));
  await shot("check-email-no-address");

  mocks = { ...SIGNED_OUT };
  await go("/check-email", { storage: { "session:amityexams:pending-email": "riya.sharma@s.amity.edu" } });
  check("arriving from sign-up, resend waits before it can be pressed", await evaluate("[...document.querySelectorAll('button')].some((b) => b.disabled && /again in/i.test(b.innerText))"));

  mocks = { ...VERIFIED };
  await go("/switch", { storage: { "amityexams:profile": `u:${OTHER}` } });
  await sleep(500);
  await click("Use Local Mode instead");
  await sleep(600);
  check("'Use Local Mode instead' stores Local Mode, only when pressed", (await evaluate("localStorage.getItem('amityexams:profile')")) === "local");

  mocks = { ...VERIFIED };
  await go("/switch?next=%2Fsubjects", { storage: { "amityexams:profile": `u:${USER}` } });
  await sleep(1200);
  check("the same account already open goes straight on to ?next", (await evaluate("location.pathname")) === "/subjects", await evaluate("location.pathname"));

  mocks = {};
  await go("/auth/confirm#token_hash=fragmentToken123&type=signup", { storage: {} });
  check("a link with the token in the fragment works", (await h1()) === "Confirm your email", await h1());
  check("and the fragment is cleaned from the address bar", (await evaluate("location.hash")) === "", await evaluate("location.href"));
});

await scenario("blocked storage never silently opens Local Mode", async () => {
  mocks = { ...VERIFIED };
  await go("/switch", { storage: { "amityexams:profile": "local" } });
  await sleep(500);
  await evaluate("Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); }; true");
  await click("Open this account's data");
  await sleep(500);
  check("it stays on /switch and says the choice couldn't be saved", (await evaluate("location.pathname")) === "/switch" && (await text()).includes("didn't let Amity Exams save"), await text());
  await shot("switch-not-saved");
});

// ── Keyboard walk on the sign-in form ─────────────────────────────────────────────────────────────────────────
await scenario("keyboard order on sign in", async () => {
  mocks = { ...SIGNED_OUT };
  await go("/login", { storage: {} });
  const order = [];
  check("the screen's heading has focus on arrival", (await evaluate("document.activeElement?.tagName")) === "H1", await evaluate("document.activeElement?.tagName"));
  const outlines = [];
  for (let i = 0; i < 7; i++) {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await sleep(250); // the field's ring fades in over 150 ms
    // Fields show focus as a 3px accent ring (box-shadow); everything else as the global outline.
    outlines.push(await evaluate("(() => { const a = document.activeElement; const s = getComputedStyle(a); return a.tagName === 'INPUT' ? /0px 0px 0px 3px/.test(s.boxShadow) : s.outlineStyle !== 'none'; })()"));
    order.push(await evaluate("(() => { const a = document.activeElement; const l = a.id && document.querySelector('label[for=\"' + CSS.escape(a.id) + '\"]'); return (l && l.textContent.trim()) || a.getAttribute('aria-label') || a.innerText.trim(); })()"));
  }
  // Each screen focuses its heading on arrival, so the first Tab lands on the first field (the wordmark is before
  // the heading, one Shift+Tab away).
  const want = ["Email", "Password", "Show password", "Forgot your password?", "Sign in", "Create an account", "Continue without an account"];
  check("tab order follows the screen", want.every((w, i) => order[i] === w), order.join(" > "));
  // Buttons and links show the global outline; fields show their indigo border and ring instead (by design).
  check("every control shows focus when tabbed to", outlines.every(Boolean), order.map((o, i) => `${o}:${outlines[i]}`).join(", "));
});

// ── Report ───────────────────────────────────────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
const seriousAxe = axeFindings.filter((a) => a.impact === "serious" || a.impact === "critical");
writeFileSync(join(OUT, "report.json"), JSON.stringify({ base: BASE, results, axe: axeFindings }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed; axe: ${seriousAxe.length} serious/critical (${axeFindings.length} total). Screenshots and report: ${OUT}`);
for (const a of seriousAxe) console.log(`  axe ${a.impact} ${a.id} in ${a.state} (${a.nodes} nodes, e.g. ${a.sample})`);
ws.close();
chrome.kill();
await sleep(500);
try {
  rmSync(profileDir, { recursive: true, force: true });
} catch {}
process.exit(failed.length ? 1 : 0);
