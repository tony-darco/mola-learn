"use client";

import { useId, useState } from "react";
import type { z } from "zod";
import type { canvasBackgroundPatternSchema } from "@mola/shared";
import { createCanvasAction } from "@/lib/canvas/actions";
import { BACKGROUND_COLORS } from "@/lib/canvas/styleConstants";

type Pattern = z.infer<typeof canvasBackgroundPatternSchema>;

const PATTERN_OPTIONS: { value: Pattern; label: string }[] = [
  { value: "dots", label: "Dot Grid" },
  { value: "grid", label: "Grid" },
  { value: "lines", label: "Lines" },
  { value: "blank", label: "Blank" },
];

/** Matches the "New Whiteboard" reference: name, background pattern + color, Cancel/Create. */
export function NewCanvasDialog({ onClose }: { onClose: () => void }) {
  const nameId = useId();
  const [pattern, setPattern] = useState<Pattern>("dots");
  const [color, setColor] = useState(BACKGROUND_COLORS[0]!);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <form
        action={createCanvasAction}
        onClick={(e) => e.stopPropagation()}
        className="flex w-80 flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-xl"
      >
        <h2 className="text-lg font-semibold text-fg">New Whiteboard</h2>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={nameId} className="text-xs font-medium uppercase tracking-wide text-fg-muted">
            Name
          </label>
          <input
            id={nameId}
            name="name"
            type="text"
            placeholder="Untitled canvas"
            autoFocus
            className="rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-fg focus:outline-none focus:border-accent"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-fg-muted">Background</span>

          <input type="hidden" name="backgroundPattern" value={pattern} />
          <div className="grid grid-cols-2 gap-1.5">
            {PATTERN_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPattern(opt.value)}
                aria-pressed={pattern === opt.value}
                className={`rounded-md border px-2 py-1.5 text-xs ${
                  pattern === opt.value ? "border-accent bg-accent text-accent-fg" : "border-border text-fg-muted hover:bg-bg"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <input type="hidden" name="backgroundColor" value={color} />
          <div className="mt-1 flex gap-1.5">
            {BACKGROUND_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Background color ${c}`}
                onClick={() => setColor(c)}
                className="h-6 w-6 rounded-full border border-border"
                style={{ backgroundColor: c, outline: color === c ? "2px solid var(--accent)" : "none", outlineOffset: 1 }}
              />
            ))}
          </div>
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:bg-bg"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-fg hover:opacity-90"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
