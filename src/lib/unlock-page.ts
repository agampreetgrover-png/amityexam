// The password form shown for APP_PASSWORD, by /unlock and by the middleware for a locked page load.

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/**
 * Only paths inside this app, or "/". Checked the way the browser will read the Location header: the URL parser
 * drops tabs and newlines and treats "\" as "/", so "/\t/evil.example" or "/\evil.example" would otherwise slip
 * past a plain prefix check and leave the app. The normalised path is what's returned, never the raw input.
 */
export function safeNext(v: unknown): string {
  if (typeof v !== "string" || !v.startsWith("/") || v.length > 2000) return "/";
  const base = "http://app.invalid";
  let url: URL;
  try {
    url = new URL(v, base);
  } catch {
    return "/";
  }
  if (url.origin !== base) return "/";
  const path = url.pathname + url.search + url.hash;
  // "/.//evil.example" normalises to "//evil.example", which a browser reads as another host.
  return path.startsWith("//") ? "/" : path;
}

/** The password form; posts to /unlock, which sends the browser on to `next`. */
export function unlockPage(next: string, error = "", status = 200) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Amity Exams</title>
<style>
:root{--bg:#f8fafc;--surface:#fff;--text:#0f172a;--muted:#5b6b82;--border:#e2e8f0;--accent:#4f46e5;--bad:#b91c1c;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#0b0d13;--surface:#131622;--text:#f1f5f9;--muted:#94a3b8;--border:#262a37;--accent:#818cf8;--bad:#f87171}}
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
form{width:100%;max-width:340px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:28px 24px}
h1{margin:0 0 4px;font-size:20px}p{margin:0 0 20px;color:var(--muted);font-size:14px}
label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}
input{width:100%;height:40px;padding:0 12px;border:1px solid var(--border);border-radius:8px;background:transparent;color:inherit;font:inherit}
input:focus{outline:2px solid var(--accent);outline-offset:1px}
button{margin-top:14px;width:100%;height:40px;border:0;border-radius:8px;background:#4f46e5;color:#fff;font:inherit;font-weight:600;cursor:pointer}
.err{margin:12px 0 0;color:var(--bad);font-size:13px}
</style></head><body>
<form method="post" action="/unlock">
<h1>Amity Exams</h1><p>Enter the password to open the app on this device.</p>
<label for="pw">Password</label>
<input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
<input type="hidden" name="next" value="${escape(next)}">
<button type="submit">Open</button>
${error ? `<p class="err" role="alert">${escape(error)}</p>` : ""}
</form></body></html>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
