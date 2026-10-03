"use client";

import { useEffect, useRef, useState } from "react";
import { PencilLine, SquareDashed, X } from "lucide-react";
import type { CanvasContext } from "@/lib/canvas/chat";
import type { Rect } from "@/lib/canvas/marquee";
import { Markdown } from "../Markdown";
import type { CanvasTurn } from "./useCanvasChat";

export type ChatAttachment = { rect: Rect; count: number };

const pt = (x: number, y: number) => `(${Math.round(x)}, ${Math.round(y)})`;

/** Exactly what went to the model with a message — for checking the reader, collapsed by default. */
function WhatTheAISaw({ context }: { context: CanvasContext }) {
  const { region } = context;
  return (
    <details className="mt-1 w-full text-xs text-fg-muted">
      <summary className="cursor-pointer select-none text-right hover:text-fg">What the AI saw</summary>
      <div className="mt-1 rounded-lg border border-border bg-bg p-2">
        <div className="mb-1">
          {region ? `Selection from ${pt(region.minX, region.minY)} to ${pt(region.maxX, region.maxY)}` : "The whole canvas"}
        </div>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-snug text-fg">
          {context.changes ? `${context.changes}\n\n${context.text}` : context.text}
        </pre>
      </div>
    </details>
  );
}

/**
 * The canvas's own conversation, as a right-hand panel on the canvas page.
 * A selection attached from the selection menu shows as a chip and goes with
 * every message until it's removed; without one, the AI reads the whole board.
 */
export function CanvasChatPanel({
  turns, busy, loadError, attachment, onRemoveAttachment, onSend, onClose,
}: {
  turns: CanvasTurn[];
  busy: boolean;
  loadError: string | null;
  attachment: ChatAttachment | null;
  onRemoveAttachment: () => void;
  onSend: (text: string) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns]);

  // A fresh attachment (Ask AI) means the next thing to do is type.
  useEffect(() => {
    if (attachment) textareaRef.current?.focus();
  }, [attachment]);

  function submit() {
    if (busy || !input.trim()) return;
    onSend(input);
    setInput("");
  }

  return (
    <aside data-testid="canvas-chat" className="flex h-full w-96 shrink-0 flex-col border-l border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-sm font-medium text-fg">Ask AI about this canvas</span>
        <button
          type="button"
          onClick={onClose}
          title="Close chat"
          aria-label="Close chat"
          className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-bg hover:text-fg"
        >
          <X size={16} />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {loadError && <p className="text-sm text-red-700 dark:text-red-400">Couldn&apos;t load this conversation: {loadError}</p>}
        {!loadError && turns.length === 0 && (
          <p className="text-sm text-fg-muted">
            Select part of the board and choose Ask AI, or just ask — without a selection the AI reads the whole canvas.
          </p>
        )}
        {turns.map((t) => (t.role === "event" ? (
          // An entry in the edit log: a change to the board, told by label — not a message.
          <div key={t.id} data-testid="canvas-edit-entry" className="mb-1.5 flex items-start gap-1.5 text-[11px] leading-snug text-fg-muted">
            <PencilLine size={11} className="mt-px shrink-0" aria-hidden />
            <span>{t.text}</span>
          </div>
        ) : t.role === "user" ? (
          <div key={t.id} data-testid="canvas-turn-user" className="mb-4 flex flex-col items-end">
            <div className="max-w-[90%] rounded-2xl border border-border bg-bg px-3 py-2 text-sm">
              <Markdown text={t.text} />
            </div>
            {t.context && <WhatTheAISaw context={t.context} />}
          </div>
        ) : (
          <div key={t.id} data-testid="canvas-turn-assistant" className="mb-4 text-sm">
            {t.text && <Markdown text={t.text} />}
            {!t.text && t.streaming && <div className="animate-pulse text-fg-muted">…</div>}
            {t.error && (
              <div className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400">{t.error}</div>
            )}
          </div>
        )))}
      </div>

      <div className="border-t border-border p-3">
        {attachment && (
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-bg py-1 pl-2.5 pr-1 text-xs text-fg">
            <SquareDashed size={12} className="text-accent" />
            Selection · {attachment.count} {attachment.count === 1 ? "item" : "items"}
            <button
              type="button"
              onClick={onRemoveAttachment}
              title="Remove selection"
              aria-label="Remove selection"
              className="flex h-5 w-5 items-center justify-center rounded-full text-fg-muted hover:bg-surface hover:text-fg"
            >
              <X size={12} />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2 rounded-2xl border border-border bg-bg p-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask about this canvas…"
            disabled={busy}
            rows={2}
            className="max-h-40 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm text-fg placeholder:text-fg-muted focus:outline-none disabled:opacity-60"
          />
          <button
            type="button"
            onClick={submit}
            disabled={busy || !input.trim()}
            title="Send"
            aria-label="Send"
            className="shrink-0 rounded-md px-2 py-1 text-lg leading-none text-fg hover:bg-surface disabled:cursor-default disabled:opacity-50"
          >
            ⏎
          </button>
        </div>
      </div>
    </aside>
  );
}
