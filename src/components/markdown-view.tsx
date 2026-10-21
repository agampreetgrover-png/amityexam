"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "./ui";

type MdNode = { type: string; value?: string; children?: MdNode[] };

/**
 * AI answers put <br> inside table cells, where Markdown has no other way to break a line. Raw HTML stays
 * escaped (it's untrusted), so turn just those tags into real line breaks instead of showing "<br>" as text.
 */
function remarkBreaks() {
  const walk = (node: MdNode) => {
    node.children?.forEach((child, i) => {
      if (child.type === "html" && /^<br\s*\/?>$/i.test(child.value?.trim() ?? "")) node.children![i] = { type: "break" };
      else walk(child);
    });
  };
  return walk;
}

export default function MarkdownView({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("prose-ai text-sm", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          // AI output can contain links; open them in a new tab without giving that page access to this one.
          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
