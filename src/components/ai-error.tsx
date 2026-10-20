"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { AiError } from "@/lib/ai/client";

/** Inline error line; shows a countdown when the AI provider returns a rate limit. */
export function AiErrorBox({ error }: { error: unknown }) {
  const retry = error instanceof AiError ? error.retryAfter : undefined;
  const [left, setLeft] = useState(retry ?? 0);
  useEffect(() => {
    setLeft(retry ?? 0);
    if (!retry) return;
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [error, retry]);
  if (!error) return null;
  return (
    <div role="alert" className="flex items-start gap-2 border-l-2 border-bad py-1 pl-3 text-sm text-bad">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
      <span className="whitespace-pre-line">
        {error instanceof Error ? error.message : String(error)}
        {left > 0 && ` You can retry in ${left}s.`}
      </span>
    </div>
  );
}
