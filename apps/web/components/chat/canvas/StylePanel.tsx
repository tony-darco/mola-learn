"use client";

import { Bold, Italic } from "lucide-react";
import type { z } from "zod";
import type { canvasDashStyleSchema, canvasFillStyleSchema } from "@mola/shared";
import { COLOR_PALETTE, STROKE_WIDTHS, type WidthCategory } from "@/lib/canvas/styleConstants";

type DashStyle = z.infer<typeof canvasDashStyleSchema>;
type FillStyle = z.infer<typeof canvasFillStyleSchema>;

/** Which optional sections apply to the current tool/selection. */
export type StyleContext = {
  dash: boolean;
  fill: boolean;
  /** Swaps the "Width" (stroke width) row's label to "Text size" — the
   * caller still supplies widthCategory/onWidthChange, just routes the
   * category to a font-size table instead of a stroke-width one. */
  fontSize: boolean;
  /** Shows the Background swatch row and Bold/Italic toggles. */
  text: boolean;
};

export function StylePanel({
  context, color, onColorChange, widthCategory, onWidthChange, opacity, onOpacityChange, onOpacityDragStart,
  dash, onDashChange, fillStyle, onFillStyleChange,
  backgroundColor, onBackgroundColorChange, allowNoBackground,
  bold, onBoldChange, italic, onItalicChange,
}: {
  context: StyleContext;
  color: string; onColorChange: (c: string) => void;
  widthCategory: WidthCategory; onWidthChange: (w: WidthCategory) => void;
  opacity: number; onOpacityChange: (o: number) => void;
  /** Called on pointerdown of the opacity slider — lets the caller snapshot
   * undo history once per drag instead of once per slider tick. */
  onOpacityDragStart?: () => void;
  dash: DashStyle; onDashChange: (d: DashStyle) => void;
  fillStyle: FillStyle; onFillStyleChange: (f: FillStyle) => void;
  backgroundColor?: string | null; onBackgroundColorChange?: (c: string | null) => void; allowNoBackground?: boolean;
  bold?: boolean; onBoldChange?: (b: boolean) => void;
  italic?: boolean; onItalicChange?: (b: boolean) => void;
}) {
  return (
    <div className="absolute left-4 top-20 z-20 flex w-52 flex-col gap-3 rounded-xl border border-border bg-surface p-3 shadow-lg">
      <div>
        <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-fg-muted">{context.text ? "Font color" : "Color"}</div>
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

      {context.text && (
        <div>
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-fg-muted">Background</div>
          <div className="grid grid-cols-4 gap-1.5">
            {allowNoBackground && (
              <button
                type="button"
                aria-label="No background"
                onClick={() => onBackgroundColorChange?.(null)}
                className="relative h-6 w-6 rounded-full bg-[repeating-conic-gradient(#ccc_0_25%,transparent_0_50%)] bg-[length:6px_6px]"
                style={{ outline: backgroundColor === null ? "2px solid var(--accent)" : "1px solid var(--border)", outlineOffset: 1 }}
              />
            )}
            {COLOR_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Background ${c}`}
                onClick={() => onBackgroundColorChange?.(c)}
                className="h-6 w-6 rounded-full"
                style={{ backgroundColor: c, outline: backgroundColor === c ? "2px solid var(--accent)" : "1px solid var(--border)", outlineOffset: 1 }}
              />
            ))}
          </div>
        </div>
      )}

      {context.text && (
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => onBoldChange?.(!bold)}
            aria-pressed={bold}
            title="Bold"
            className={`flex flex-1 items-center justify-center rounded-md border py-1 ${bold ? "border-accent bg-accent text-accent-fg" : "border-border text-fg-muted hover:bg-bg"}`}
          >
            <Bold size={15} />
          </button>
          <button
            type="button"
            onClick={() => onItalicChange?.(!italic)}
            aria-pressed={italic}
            title="Italic"
            className={`flex flex-1 items-center justify-center rounded-md border py-1 ${italic ? "border-accent bg-accent text-accent-fg" : "border-border text-fg-muted hover:bg-bg"}`}
          >
            <Italic size={15} />
          </button>
        </div>
      )}

      <div>
        <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-fg-muted">{context.fontSize ? "Text size" : "Width"}</div>
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
          onPointerDown={onOpacityDragStart}
          onChange={(e) => onOpacityChange(Number(e.target.value))}
          style={{ accentColor: "var(--accent)" }}
          className="w-full"
        />
      </div>
    </div>
  );
}
