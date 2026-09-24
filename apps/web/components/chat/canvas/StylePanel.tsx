"use client";

import type { z } from "zod";
import type { canvasDashStyleSchema, canvasFillStyleSchema } from "@mola/shared";
import { COLOR_PALETTE, STROKE_WIDTHS, type WidthCategory } from "@/lib/canvas/styleConstants";

type DashStyle = z.infer<typeof canvasDashStyleSchema>;
type FillStyle = z.infer<typeof canvasFillStyleSchema>;

/** Which optional sections apply to the current tool/selection. */
export type StyleContext = {
  dash: boolean;
  fill: boolean;
};

export function StylePanel({
  context, color, onColorChange, widthCategory, onWidthChange, opacity, onOpacityChange,
  dash, onDashChange, fillStyle, onFillStyleChange,
}: {
  context: StyleContext;
  color: string; onColorChange: (c: string) => void;
  widthCategory: WidthCategory; onWidthChange: (w: WidthCategory) => void;
  opacity: number; onOpacityChange: (o: number) => void;
  dash: DashStyle; onDashChange: (d: DashStyle) => void;
  fillStyle: FillStyle; onFillStyleChange: (f: FillStyle) => void;
}) {
  return (
    <div className="absolute left-3 top-16 z-10 flex w-52 flex-col gap-3 rounded-xl border border-border bg-surface p-3 shadow-lg">
      <div>
        <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-fg-muted">Color</div>
        <div className="grid grid-cols-4 gap-1.5">
          {COLOR_PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              onClick={() => onColorChange(c)}
              className="h-6 w-6 rounded-full"
              style={{ backgroundColor: c, outline: color === c ? "2px solid var(--accent)" : "1px solid var(--border)", outlineOffset: 1 }}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-fg-muted">Width</div>
        <div className="flex gap-1">
          {(Object.keys(STROKE_WIDTHS) as WidthCategory[]).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => onWidthChange(w)}
              className={`flex-1 rounded-md border px-2 py-1 text-xs ${
                widthCategory === w ? "border-accent bg-accent text-accent-fg" : "border-border text-fg-muted hover:bg-bg"
              }`}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      {context.dash && (
        <div>
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-fg-muted">Stroke</div>
          <div className="flex gap-1">
            {(["solid", "dashed", "dotted"] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => onDashChange(d)}
                className={`flex-1 rounded-md border px-2 py-1 text-xs capitalize ${
                  dash === d ? "border-accent bg-accent text-accent-fg" : "border-border text-fg-muted hover:bg-bg"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      )}

      {context.fill && (
        <div>
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-fg-muted">Fill</div>
          <div className="flex gap-1">
            {(["none", "solid", "hachure", "crosshatch"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => onFillStyleChange(f)}
                className={`flex-1 rounded-md border px-1.5 py-1 text-[11px] capitalize ${
                  fillStyle === f ? "border-accent bg-accent text-accent-fg" : "border-border text-fg-muted hover:bg-bg"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-1.5 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-fg-muted">
          <span>Opacity</span>
          <span>{Math.round(opacity * 100)}%</span>
        </div>
        <input
          type="range" min={0.1} max={1} step={0.05} value={opacity}
          onChange={(e) => onOpacityChange(Number(e.target.value))}
          style={{ accentColor: "var(--accent)" }}
          className="w-full"
        />
      </div>
    </div>
  );
}
