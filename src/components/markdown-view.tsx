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
          // AI output can contain links; open them in a new tab without giving that page access to this one. An
          // instruction hidden in a Drive file could make the AI write a harmless-sounding link whose URL carries the
          // student's question off to another site, so the real host always shows beside it. Anything that isn't a
          // full web address (relative, //host, mailto) stays plain text. Parsed with no base, so nothing reads window.
          a: ({ href, children }) => {
            let host = "";
            try {
              const u = new URL(href ?? "");
              if (u.protocol === "http:" || u.protocol === "https:") host = u.hostname;
            } catch {
              // not a full address
            }
            if (!host) return <span>{children}</span>;
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
                <span className="text-xs text-muted"> ({host})</span>
              </a>
            );
          },
          // Never load images: an instruction hidden in a Drive file could make the AI add one whose URL carries
          // the student's question off to another site. Show the alt text instead.
          img: ({ alt }) => (alt ? <span>[{alt}]</span> : null),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
