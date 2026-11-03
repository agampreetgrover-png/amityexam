"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { AuthFailure, CaptchaAction } from "@/lib/auth/client";

// Cloudflare Turnstile on the sign-in, sign-up and email forms. The server checks every token itself and refuses a
// request without one (src/lib/auth/captcha.ts): this widget only gets the token. A token works once, so the widget
// is reset after every request, whatever the answer.
//
// The browser loads Cloudflare's script (challenges.cloudflare.com) only on these forms. The site key is public by
// design; the secret never leaves the server.

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

type Turnstile = {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let loading: Promise<Turnstile> | null = null;
function loadTurnstile(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
    s.onerror = () => {
      loading = null; // let a later attempt try again
      reject(new Error("turnstile failed to load"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * What a form sends: the token when there is one; otherwise the failure the form shows, without asking the server
 * (it would refuse anyway). Exported for tests.
 */
export function captchaOrFailure(token: string | null): { token: string } | AuthFailure {
  return token ? { token } : { ok: false, code: "captcha_failed" };
}

export interface Captcha {
  /** The widget, to place inside the form. */
  widget: ReactNode;
  /** The current token, or null while there is none (not solved yet, expired, or already used). */
  token: string | null;
  /** Call after every request that used the token: it can't be used again. */
  reset(): void;
}

export function useCaptcha(action: CaptchaAction): Captcha {
  const box = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!SITE_KEY || !box.current) return;
    let cancelled = false;
    const el = box.current;
    loadTurnstile()
      .then((t) => {
        if (cancelled || widgetId.current) return;
        widgetId.current = t.render(el, {
          sitekey: SITE_KEY,
          action,
          theme: "auto",
          size: "flexible",
          callback: (value: string) => {
            setFailed(false);
            setToken(value);
          },
          "expired-callback": () => setToken(null),
          "error-callback": () => {
            setToken(null);
            setFailed(true);
          },
        });
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (widgetId.current) {
        try {
          window.turnstile?.remove(widgetId.current);
        } catch {}
        widgetId.current = null;
      }
    };
  }, [action]);

  const reset = useCallback(() => {
    setToken(null);
    if (widgetId.current) {
      try {
        window.turnstile?.reset(widgetId.current);
      } catch {}
    }
  }, []);

  const widget = (
    <div className="mt-5">
      <div ref={box} className="min-h-[65px]" data-captcha-action={action} />
      {failed && (
        <p role="status" className="mt-1.5 text-[13px] text-muted">
          The security check couldn&apos;t load. Check your connection, or turn off anything that blocks
          challenges.cloudflare.com, then reload the page.
        </p>
      )}
    </div>
  );
  return { widget, token, reset };
}
