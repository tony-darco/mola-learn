"use client";

import { useState } from "react";
import { Markdown } from "./Markdown";
import { ActivityRow } from "./ActivityRow";
import { ArtifactBlock } from "./artifacts/ArtifactBlock";
import { timeAgo } from "./time-ago";
import type { Turn } from "./types";

export function TurnView({
  turn,
  canRetry = false,
  disabled = false,
  onRetry,
}: {
  turn: Turn;
  /** Whether this turn has actually been responded to — hidden while its
   * paired reply is still streaming, so retry never targets an in-flight turn. */
  canRetry?: boolean;
  disabled?: boolean;
  onRetry?: () => void;
}) {
  const isUser = turn.role === "user";
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(turn.text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      (err: unknown) => console.error("copy failed:", err),
    );
  }

  return (
    <div
      data-testid={isUser ? "turn-user" : "turn-assistant"}
      className={`group mb-6 flex flex-col ${isUser ? "items-end" : "items-start"}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="mb-1 px-1 text-sm font-medium text-fg-muted">{isUser ? "You" : "Mola"}</div>

      <div className={isUser ? "max-w-[85%]" : "w-full"}>
        {/* Index folded into the key: turns persisted before crypto.randomUUID()
            landed in ollama.ts can still contain literal duplicate tool-call
            ids, which would otherwise collide as React keys. */}
        {turn.activity.map((a, i) => <ActivityRow key={`${a.id}-${i}`} entry={a} />)}

        {turn.text && (
          <div className={isUser ? "rounded-2xl border border-border bg-surface px-4 py-2.5" : ""}>
            <Markdown text={turn.text} />
          </div>
        )}
        {!turn.text && turn.streaming && <div className="animate-pulse text-fg-muted">…</div>}

        {turn.artifacts.map((a) => <ArtifactBlock key={a.id} artifact={a} />)}

        {turn.error && (
          <div
            data-testid="turn-error"
            className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400"
          >
            {turn.error}
          </div>
        )}

        {/* Only surfaces once this turn has actually been answered — a
         * mid-stream turn shows neither retry nor the (frozen, misleading)
         * timestamp. Visible on hover, kept mounted so a click landing right
         * as the mouse leaves still registers. */}
        {canRetry && turn.text && (
          <div
            className={`mt-1 flex items-center justify-end gap-1 text-fg-muted ${
              hovered ? "opacity-100" : "opacity-0 group-focus-within:opacity-100"
            } transition-opacity`}
          >
            {isUser && <span className="mr-1.5 text-sm">{timeAgo(turn.createdAt)}</span>}
            <button
              type="button"
              onClick={copy}
              title={copied ? "Copied" : "Copy"}
              aria-label="Copy"
              className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface hover:text-fg"
            >
              {copied ? (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <rect x="9" y="9" width="10" height="10" rx="1.5" />
                  <path strokeLinecap="round" d="M6 15H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={onRetry}
              disabled={disabled}
              title="Retry"
              aria-label="Retry"
              className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface hover:text-fg disabled:cursor-default disabled:opacity-50"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
                />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
