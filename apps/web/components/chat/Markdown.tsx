"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ComponentProps } from "react";

/** Assistant/user turn text, rendered as markdown with fenced code blocks. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ code: CodeBlock }}>
        {text}
      </ReactMarkdown>
    </div>
  );
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
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5 text-xs text-fg-muted">
        <span>{language || "text"}</span>
        <CopyButton text={String(children)} />
      </div>
      <pre className="overflow-x-auto bg-surface p-3.5">
        <code className={`${className ?? ""} font-mono text-[13px] whitespace-pre`} {...rest}>
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
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
