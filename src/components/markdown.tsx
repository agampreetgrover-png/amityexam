"use client";

import { lazy, Suspense } from "react";

// react-markdown + remark-gfm are ~45 kB, so they load on first use. Until then the raw text shows.
const MarkdownView = lazy(() => import("./markdown-view"));

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <Suspense fallback={<div className="prose-ai whitespace-pre-wrap text-sm">{children}</div>}>
      <MarkdownView className={className}>{children}</MarkdownView>
    </Suspense>
  );
}
