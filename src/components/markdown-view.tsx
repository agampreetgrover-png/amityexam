"use client";

import { Check, Copy } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { type ExtraProps } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { normalizeMathDelimiters } from "@/lib/math-delimiters";
import { toast } from "./toast";
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

/**
 * A fenced code block: its language and a copy button above the code. Only a code element inside a pre gets here
 * (react-markdown v10 has no `inline` flag), so inline `code` keeps its plain look. The language is AI text, shown as text.
 */
function CodeBlock({ node, children }: { children?: ReactNode } & ExtraProps) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const code = node?.children[0];
  const cls = code?.type === "element" ? code.properties.className : undefined;
  const lang = Array.isArray(cls) ? cls.map(String).find((c) => c.startsWith("language-"))?.slice(9) : undefined;
  const copy = async () => {
    try {
      // Read from the page, so it's the code as shown: highlighting only wraps it in spans.
      await navigator.clipboard.writeText((ref.current?.textContent ?? "").replace(/\n$/, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Couldn't copy. Select the code instead.");
    }
  };
  return (
    <div className="code-block">
      <div className="flex items-center justify-between gap-2 border-b border-border py-1 pl-3 pr-1.5 text-xs text-muted">
        <span className="min-w-0 truncate font-mono">{lang || "code"}</span>
        {/* The ::before widens the tap target on touch screens to about 40px without changing the icon's look. */}
        <button type="button" onClick={copy} aria-label="Copy code" title="Copy code" className="relative shrink-0 rounded-md p-1 text-faint transition-colors duration-150 hover:bg-surface-3 hover:text-text pointer-coarse:before:absolute pointer-coarse:before:-inset-2.5 pointer-coarse:before:content-['']">
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}

export default function MarkdownView({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("prose-ai text-sm", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
        // Formulas: $...$ in a line, $$...$$ on their own (\(...\) and \[...\] are turned into those first). The TeX
        // is AI text, so untrusted: trust stays off (no \href, \url, \html* or \includegraphics), and maxSize caps
        // the size of \rule and \kern. Overlap tricks (\mathllap, \smash, a negative \kern) are clipped to the
        // formula's own box by the .prose-ai .katex rule in globals.css. Never pass a shared macros object or add
        // rehype-raw. Whatever it draws still goes through the link and image rules below. A formula it can't read
        // (or one still arriving) shows in the theme's red rather than KaTeX's fixed one, murky on the dark canvas.
        // Then code blocks are coloured: rehype-highlight only splits the code into classed spans (no HTML is parsed),
        // and only when the block names its language; a language it doesn't know stays plain instead of throwing.
        rehypePlugins={[
          [rehypeKatex, { trust: false, strict: "ignore", maxSize: 20, maxExpand: 200, errorColor: "var(--bad)" }],
          [rehypeHighlight, { detect: false }],
        ]}
        components={{
          pre: CodeBlock,
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
        {normalizeMathDelimiters(children)}
      </ReactMarkdown>
    </div>
  );
}
