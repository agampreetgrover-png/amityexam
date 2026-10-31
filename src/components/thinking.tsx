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
    // Set where the answer will start, on the page like the answer itself.
    <div className="flex justify-start px-1">
      <div role="status" className="flex items-center gap-3 text-[14px] text-muted">
        <span aria-hidden className="thinking-dots"><span /><span /><span /></span>
        <span>{stage}</span>
        {secs >= 5 && <span aria-hidden className="tabular-nums text-faint">{secs}s</span>}
      </div>
    </div>
  );
}
