"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import type { ComponentProps, ReactNode } from "react";

/**
 * Assistant/user turn text, rendered as markdown — fenced code blocks
 * (syntax-highlighted via rehype-highlight/highlight.js) and LaTeX math
 * (`$inline$` / `$$block$$`, via remark-math + rehype-katex) so the same
 * turn reads correctly whether it's a Python snippet, a proof, or a matrix.
 */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown text-base">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{ code: CodeBlock }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** Recursively flattens rendered children back to plain text — rehype-highlight
 * wraps tokens in nested <span>s, so `children` is no longer a plain string
 * by the time this runs; the copy button still needs the raw code text. */
function textContent(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (typeof node === "object" && "props" in node) {
    return textContent((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

function CodeBlock({ className, children, ...rest }: ComponentProps<"code">) {
  const isBlock = /language-/.test(className ?? "");
  if (!isBlock) {
    return (
      <code className="rounded border border-border bg-bg px-1.5 py-px font-mono text-[0.9em]" {...rest}>
        {children}
      </code>
    );
  }

  const language = /language-(\w+)/.exec(className ?? "")?.[1] ?? "";

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5 text-sm text-fg-muted">
        <span>{language || "text"}</span>
        <CopyButton text={textContent(children)} />
      </div>
      <pre className="overflow-x-auto bg-surface p-3.5">
        <code className={`${className ?? ""} font-mono text-sm whitespace-pre`} {...rest}>
          {children}
        </code>
      </pre>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="text-fg-muted hover:text-accent"
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          (err: unknown) => console.error("copy failed:", err),
        );
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
