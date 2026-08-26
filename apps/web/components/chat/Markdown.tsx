"use client";

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
    return <code className="inline-code" {...rest}>{children}</code>;
  }
  return (
    <pre className="code-block">
      <code className={className} {...rest}>{children}</code>
    </pre>
  );
}
