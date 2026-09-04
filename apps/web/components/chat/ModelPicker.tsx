"use client";

import { useState } from "react";
import { CHAT_MODELS } from "@/lib/llm/models";

/**
 * Pill + popover — pick the Ollama model and thinking on/off for a chat.
 * Purely controlled: persistence (PATCH an existing chat, or fold into the
 * POST when creating one) is the caller's job, not this component's.
 */
export function ModelPicker({
  model, thinkingEnabled, onChange, disabled,
}: {
  model: string;
  thinkingEnabled: boolean;
  onChange: (next: { model: string; thinkingEnabled: boolean }) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = CHAT_MODELS.find((m) => m.id === model);

  return (
    <div className="relative">
      {open && (
        <div className="absolute bottom-full right-0 z-10 mb-1 w-60 rounded-lg border border-border bg-surface p-1 shadow-lg">
          {CHAT_MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                setOpen(false);
                // Only the toggle below changes thinkingEnabled — switching models never
                // touches it, so flipping back to a thinking-capable model doesn't leave
                // it stuck off from a prior clamp. The picker still shows "Off" for a
                // non-supporting model (below); the runtime layer clamps for real.
                onChange({ model: m.id, thinkingEnabled });
              }}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left hover:bg-bg"
            >
              <span>
                <span className="block text-sm text-fg">{m.label}</span>
                <span className="block text-xs text-fg-muted">{m.description}</span>
              </span>
              {m.id === model && <span className="shrink-0 text-fg-muted">✓</span>}
            </button>
          ))}
          <div className="mt-1 flex items-center justify-between gap-2 border-t border-border px-2.5 py-1.5">
            <span className="text-sm text-fg">Thinking</span>
            <button
              type="button"
              disabled={!current?.supportsThinking}
              onClick={() => {
                setOpen(false);
                onChange({ model, thinkingEnabled: !thinkingEnabled });
              }}
              title={current?.supportsThinking ? undefined : `${current?.label ?? model} doesn't support thinking`}
              className={`rounded-md px-2 py-1 text-xs ${
                !current?.supportsThinking
                  ? "cursor-not-allowed text-fg-muted opacity-50"
                  : thinkingEnabled
                    ? "bg-accent text-accent-fg"
                    : "border border-border text-fg-muted hover:bg-bg"
              }`}
            >
              {thinkingEnabled && current?.supportsThinking ? "On" : "Off"}
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={open}
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs text-fg-muted hover:bg-bg disabled:cursor-default disabled:opacity-50"
      >
        {current?.label ?? model}
        <span>{open ? "▾" : "▸"}</span>
      </button>
    </div>
  );
}
