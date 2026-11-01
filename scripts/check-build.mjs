// Run after `next build`: `npm run check:build`. Fails (exit 1) when
//  1. the browser bundles (.next/static) contain a Supabase client, or the value of any server-only setting
//     (the browser must never talk to Supabase or see these values), or
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

/** Values from the environment and .env.local, so a leak is found by value, not just by name. */
function serverOnlyValues() {
  const env = { ...process.env };
  const file = join(root, ".env.local");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  const names = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "RATE_LIMIT_SECRET", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "APP_PASSWORD", "AI_KEY_ENCRYPTION_SECRET"];
  return names.map((n) => [n, env[n]]).filter(([, v]) => v && v.length >= 8);
}

// 1. Browser bundles.
const staticDir = join(root, ".next", "static");
if (!existsSync(staticDir)) {
  problems.push(".next/static not found: run `npm run build` first.");
} else {
  const files = walk(staticDir).filter((f) => /\.(js|mjs|css|json|map)$/.test(f));
  const markers = ["GoTrueClient", "@supabase/", "createBrowserClient", "sb_secret_", "service_role"];
  const values = serverOnlyValues();
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const m of markers) if (text.includes(m)) problems.push(`${f}: browser bundle contains "${m}"`);
    for (const [name, value] of values) if (text.includes(value)) problems.push(`${f}: browser bundle contains the value of ${name}`);
  }
  console.log(`checked ${files.length} browser files for Supabase client code and ${values.length} server-only values`);

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
