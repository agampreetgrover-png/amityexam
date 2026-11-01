"use client";

import { useEffect, useState } from "react";

/** What the AI is doing while the first words of an answer are on their way. */
export function Thinking() {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const stage = secs < 3 ? "Reading your notes and past papers" : secs < 12 ? "Writing your answer" : "Still writing. Free AI models can be slow to start";
  return (
    // Set where the answer will start (flush with its first line), on the page like the answer itself. The stage
    // fades in when it changes, so a new line reads as progress rather than a flicker.
    <div className="flex justify-start">
      <div role="status" className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-muted">
        <span aria-hidden className="thinking-dots text-faint"><span /><span /><span /></span>
        <span key={stage} className="count-in">{stage}</span>
        {secs >= 5 && <span aria-hidden className="tabular-nums text-faint">{secs}s</span>}
      </div>
    </div>
  );
}
