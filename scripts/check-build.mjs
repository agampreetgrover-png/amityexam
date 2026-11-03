// Run after `next build`: `npm run check:build`. Fails (exit 1) when
//  1. what the browser receives (the bundles in .next/static, and the prerendered pages' HTML and RSC payloads, which
//     carry inline scripts) contains a Supabase client, or the value of any server-only setting (the browser must
//     never talk to Supabase or see these values). Values are matched, not names: a setting's name in a comment, the
//     docs or server-only code is harmless and never reported. TURNSTILE_SECRET_KEY is checked by its value when it
//     is set here, and Cloudflare's published test secrets (1x/2x/3x, 31 zeros, two letters) are always looked for,
//     or
//  2. a page in src/app/(app) reads cookies or the session (app pages must be the same for every visitor, so the
//     service worker and the CDN can never hand one person's page to another).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const problems = [];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** The environment and .env.local together (the environment wins), as the build saw them. */
function buildEnv() {
  const env = { ...process.env };
  const file = join(root, ".env.local");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}
const env = buildEnv();

/** Values of the server-only settings, so a leak is found by value, not just by name. */
function serverOnlyValues() {
  const names = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "RATE_LIMIT_SECRET", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "APP_PASSWORD", "AI_KEY_ENCRYPTION_SECRET", "TURNSTILE_SECRET_KEY"];
  return names.map((n) => [n, env[n]?.trim()]).filter(([, v]) => v && v.length >= 8);
}

// Cloudflare's published Turnstile test SECRET keys: 1x/2x/3x, 31 zeros, two capital letters (35 characters). Their
// test SITE keys have 20 zeros (1x00000000000000000000AA) and belong in the page, so they don't match. A test secret
// in the browser means a secret was wired into client code (or a NEXT_PUBLIC_ setting), whatever the real one is.
const TURNSTILE_TEST_SECRET = /(?<![0-9A-Za-z])[1-3]x0{31}[A-Z]{2}(?![0-9A-Za-z])/;

// 0. A NEXT_PUBLIC_ setting is inlined into the browser bundles at build time, so none may hold the Turnstile secret.
const turnstileSecret = env.TURNSTILE_SECRET_KEY?.trim();
for (const [name, value] of Object.entries(env)) {
  if (!name.startsWith("NEXT_PUBLIC_") || !value?.trim()) continue;
  if (turnstileSecret && value.trim() === turnstileSecret) problems.push(`${name} holds the value of TURNSTILE_SECRET_KEY (NEXT_PUBLIC_ settings are inlined into the browser bundles)`);
  else if (TURNSTILE_TEST_SECRET.test(value.trim())) problems.push(`${name} holds a Cloudflare Turnstile test secret key (NEXT_PUBLIC_ settings are inlined into the browser bundles)`);
}

// 1. What the browser receives.
const staticDir = join(root, ".next", "static");
if (!existsSync(staticDir)) {
  problems.push(".next/static not found: run `npm run build` first.");
} else {
  // Prerendered pages are sent as they are: their HTML (with the inline RSC payload scripts) and .rsc payloads.
  const prerenderedDir = join(root, ".next", "server", "app");
  const prerendered = existsSync(prerenderedDir) ? walk(prerenderedDir).filter((f) => /\.(html|rsc)$/.test(f)) : [];
  const files = [...walk(staticDir).filter((f) => /\.(js|mjs|css|json|map)$/.test(f)), ...prerendered];
  const markers = ["GoTrueClient", "@supabase/", "createBrowserClient", "sb_secret_", "service_role"];
  const values = serverOnlyValues();
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    // Supabase client code can only come from the bundles; a prerendered page may mention a name in its text.
    if (f.startsWith(staticDir)) for (const m of markers) if (text.includes(m)) problems.push(`${f}: browser bundle contains "${m}"`);
    for (const [name, value] of values) if (text.includes(value)) problems.push(`${f}: sent to the browser and contains the value of ${name}`);
    if (TURNSTILE_TEST_SECRET.test(text)) problems.push(`${f}: sent to the browser and contains a Cloudflare Turnstile test secret key`);
  }
  console.log(
    `checked ${files.length} browser files (${prerendered.length} prerendered pages) for Supabase client code, ` +
      `${values.length} server-only values and Turnstile test secrets`,
  );
  if (!turnstileSecret) console.log("note: TURNSTILE_SECRET_KEY isn't set here, so its real value couldn't be looked for (test secrets still were)");

  // Serwist's cacheOnNavigation caches every visited URL from a worker outside the service worker's routes, so the
  // never-cache rules can't stop it (sign-in pages, one-time sign-in links). It must stay off.
  const navCache = files.filter((f) => readFileSync(f, "utf8").includes("__FRONTEND_NAV_CACHE__"));
  for (const f of navCache) problems.push(`${f}: Serwist cacheOnNavigation is on (it caches pages around the service worker's rules)`);
  const publicDir = join(root, "public");
  for (const f of readdirSync(publicDir).filter((n) => /^swe-worker-.*\.js$/.test(n))) {
    problems.push(`public/${f}: Serwist's navigation-cache worker was built; cacheOnNavigation must be false`);
  }
}

// 2. App pages read no per-visitor state on the server.
const appDir = join(root, "src", "app", "(app)");
const forbidden = [/from\s+["']next\/headers["']/, /from\s+["']@\/lib\/supabase\//, /from\s+["']@\/lib\/auth["']/, /\bcookies\s*\(/, /\bheaders\s*\(\s*\)/];
const sources = walk(appDir).filter((f) => /\.(ts|tsx)$/.test(f));
for (const f of sources) {
  const text = readFileSync(f, "utf8");
  for (const re of forbidden) if (re.test(text)) problems.push(`${f}: app pages must not read cookies, headers or the session (${re})`);
}
console.log(`checked ${sources.length} app page files for cookie/session reads`);

if (problems.length) {
  console.error(`\ncheck:build FAILED\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("check:build passed");
