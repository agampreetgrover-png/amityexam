// Headless Chrome check of a running build. Start the app first (npm run build && npm start, or on another port for
// an isolated profile), then:
//   npm run check:browser -- --base http://127.0.0.1:3100 [--routes /,/subjects] [--out dir] [--mock mocks.json]
//                            [--no-shots] [--axe-fail] [--offline]
// For each route: page errors and console errors (fail), failed same-origin requests (fail), an axe-core
// accessibility scan (reported; --axe-fail makes serious/critical violations fail), and screenshots at 390, 768 and
// 1440px wide in light and dark. Chrome runs with a throwaway profile, so no real browser data is touched.
// --mock: JSON [{ "match": "/auth/session", "status": 200, "body": {...} }]; matching requests get that response,
// so every state of a screen (errors, loading, success) can be shown without real services.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);
const BASE = opt("base", "http://127.0.0.1:3100");
const ROUTES = opt("routes", "/,/subjects,/chat,/important,/zero-prep,/exams,/settings,/~offline").split(",");
const OUT = opt("out", join(tmpdir(), "amityexams-browser-check"));
const MOCKS = opt("mock") ? JSON.parse(readFileSync(opt("mock"), "utf8")) : [];
const SHOTS = !flag("no-shots");
const AXE_FAIL = flag("axe-fail");
const WIDTHS = [390, 768, 1440];
const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => p && existsSync(p));
if (!CHROME) throw new Error("No Chrome/Edge found; set CHROME_PATH.");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "amityexams-chrome-"));
const port = 9300 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });

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
let pageProblems = [];
ws.addEventListener("message", async (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) return pending.get(msg.id)(msg), pending.delete(msg.id);
  if (msg.method === "Runtime.exceptionThrown") pageProblems.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") pageProblems.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  if (msg.method === "Network.loadingFailed" && !msg.params.canceled) pageProblems.push(`request failed: ${msg.params.errorText}`);
  if (msg.method === "Network.responseReceived" && msg.params.response.url.startsWith(BASE) && msg.params.response.status >= 500) {
    pageProblems.push(`HTTP ${msg.params.response.status}: ${msg.params.response.url}`);
  }
  if (msg.method === "Fetch.requestPaused") {
    const mock = MOCKS.find((x) => msg.params.request.url.includes(x.match));
    if (!mock) return send("Fetch.continueRequest", { requestId: msg.params.requestId });
    const body = Buffer.from(typeof mock.body === "string" ? mock.body : JSON.stringify(mock.body ?? {})).toString("base64");
    send("Fetch.fulfillRequest", { requestId: msg.params.requestId, responseCode: mock.status ?? 200, responseHeaders: [{ name: "Content-Type", value: mock.contentType ?? "application/json" }, { name: "Cache-Control", value: "no-store" }], body });
  }
});
const send = (method, params = {}) => new Promise((r) => {
  const i = ++id;
  pending.set(i, r);
  ws.send(JSON.stringify({ id: i, method, params }));
});
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const settle = async () => {
  await sleep(600);
  for (let i = 0; i < 20 && (await evaluate("document.readyState")) !== "complete"; i++) await sleep(250);
  await sleep(1200);
};

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Network.setBypassServiceWorker", { bypass: true }); // check the server's pages, not a cached copy
if (MOCKS.length) await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });

// A fresh profile shows the first-launch question first; answer it once so the pages themselves are checked.
await send("Page.navigate", { url: `${BASE}/` });
await settle();
await evaluate(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Major exam")); b?.click(); return !!b; })()`);
await sleep(1500);

// --offline: with the service worker running (not bypassed), check that (1) every page opens offline, both as a
// full page load and as an in-app navigation, and (2) sign-in pages, one-time links and the API never land in any
// cache. Run it on its own: it ignores the page-by-page checks below.
if (flag("offline")) {
  await send("Network.setBypassServiceWorker", { bypass: false });
  await send("Page.navigate", { url: `${BASE}/` });
  await settle();
  const precached = await evaluate(`(async () => {
    await navigator.serviceWorker.ready;
    for (let i = 0; i < 60; i++) {
      const names = await caches.keys();
      const pre = names.find((n) => n.includes("precache"));
      if (pre && (await (await caches.open(pre)).keys()).length > 20) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  })()`);
  // Visit what must never be cached, while online, as both full page loads and in-app (history) navigations.
  const sensitive = ["/login", "/signup", "/auth/confirm?token_hash=one-time-secret&type=email", "/reset-password?code=one-time-secret", "/api/ai/status"];
  for (const p of sensitive) {
    await send("Page.navigate", { url: `${BASE}${p}` });
    await settle();
  }
  await send("Page.navigate", { url: `${BASE}/` });
  await settle();
  await evaluate(`(() => { for (const p of ${JSON.stringify(sensitive)}) { history.pushState({}, "", p); history.replaceState({}, "", p); } history.pushState({}, "", "/"); })()`);
  await sleep(2000);
  const cached = await evaluate(`(async () => { const out = []; for (const n of await caches.keys()) for (const r of await (await caches.open(n)).keys()) out.push(n + " " + new URL(r.url).pathname + new URL(r.url).search); return out; })()`);
  const leaks = cached.filter((e) => /\s\/(login|signup|check-email|forgot-password|reset-password|switch|auth|api)\b/.test(e) || e.includes("one-time-secret"));

  // The page's own heading, and whether the "You're offline" fallback (or the browser's error page) is showing.
  const PAGE_STATE = `({ h1: document.querySelector("main h1")?.innerText.trim() ?? "", fallback: /You.re offline|can.t be reached|ERR_INTERNET_DISCONNECTED/.test(document.body.innerText) })`;
  await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const results = [];
  for (const route of ROUTES) {
    pageProblems = [];
    await send("Page.navigate", { url: `${BASE}${route}` });
    await settle();
    const { h1, fallback } = await evaluate(PAGE_STATE);
    results.push({ route, how: "full page load", ok: route === "/~offline" ? fallback : !!h1 && !fallback, text: h1 || "(no h1)" });
  }
  // In-app navigation offline: start on Today, then follow the sidebar/bottom-bar links.
  await send("Page.navigate", { url: `${BASE}/` });
  await settle();
  for (const route of ROUTES.filter((r) => r !== "/" && r !== "/~offline")) {
    const clicked = await evaluate(`(() => { const a = [...document.querySelectorAll('a[href="${route}"]')].find((x) => x.offsetParent); a?.click(); return !!a; })()`);
    await sleep(1500);
    const { h1, fallback } = await evaluate(PAGE_STATE);
    const path = await evaluate("location.pathname");
    if (clicked) results.push({ route, how: "in-app link", ok: path === route && !!h1 && !fallback, text: h1 || "(no h1)" });
  }
  await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  const ok = precached && leaks.length === 0 && results.every((r) => r.ok);
  console.log(JSON.stringify({ base: BASE, precached, cacheEntries: cached.length, leaks, offline: results }, null, 2));
  ws.close();
  chrome.kill();
  await sleep(500);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
  process.exit(ok ? 0 : 1);
}

const axeSource = readFileSync(new URL("../node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
mkdirSync(OUT, { recursive: true });
const report = [];
let failed = false;

for (const route of ROUTES) {
  pageProblems = [];
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `${BASE}${route}` });
  await settle();
  const text = (await evaluate("document.body.innerText.slice(0, 160).replace(/\\s+/g, ' ')")) ?? "";
  await evaluate(axeSource);
  const axe = await evaluate(`axe.run(document, { resultTypes: ["violations"] }).then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })))`);
  const shots = [];
  if (SHOTS) {
    for (const scheme of ["light", "dark"]) {
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
      for (const width of WIDTHS) {
        await send("Emulation.setDeviceMetricsOverride", { width, height: width < 768 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 768 });
        await sleep(500);
        const shot = await send("Page.captureScreenshot", { format: "png" });
        const file = join(OUT, `${route.replace(/[^a-z0-9]+/gi, "_") || "root"}-${width}-${scheme}.png`);
        writeFileSync(file, Buffer.from(shot.result.data, "base64"));
        shots.push(file);
      }
    }
    await send("Emulation.setEmulatedMedia", { features: [] });
  }
  const seriousAxe = (axe ?? []).filter((v) => v.impact === "serious" || v.impact === "critical");
  const routeFailed = pageProblems.length > 0 || (AXE_FAIL && seriousAxe.length > 0);
  failed ||= routeFailed;
  report.push({ route, ok: !routeFailed, text, problems: pageProblems, axe, shots: shots.length });
}

console.log(JSON.stringify({ base: BASE, screenshots: SHOTS ? OUT : null, routes: report }, null, 2));
ws.close();
chrome.kill();
await sleep(500);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {}
process.exit(failed ? 1 : 0);
