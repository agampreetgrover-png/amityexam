"use client";

import { lazy, Suspense } from "react";
import { cn } from "./ui";

// react-markdown, remark-gfm, KaTeX (for formulas) and highlight.js (for code) are heavy, so they load on first use.
// Until then the raw text shows, at the same width the answer will take.
const MarkdownView = lazy(() => import("./markdown-view"));

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <Suspense fallback={<div className={cn("prose-ai whitespace-pre-wrap text-sm", className)}>{children}</div>}>
      <MarkdownView className={className}>{children}</MarkdownView>
    </Suspense>
  );
}
