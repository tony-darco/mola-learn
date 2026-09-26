"use client";

import { useRef, useState } from "react";
import type { z } from "zod";
import type { canvasBackgroundPatternSchema } from "@mola/shared";
import { Grid3x3, Home, Maximize, Minus, Plus, Rows3, Square } from "lucide-react";
import { ToolbarPopover } from "./Toolbar";

type Pattern = z.infer<typeof canvasBackgroundPatternSchema>;

function DotGridIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      {[3, 8, 13].flatMap((cy) => [3, 8, 13].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={1.2} fill="currentColor" />))}
    </svg>
  );
}

const PATTERN_OPTIONS: { value: Pattern; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
  { value: "grid", label: "Graph Paper (Grid Lines)", Icon: Grid3x3 },
  { value: "dots", label: "Dot Grid", Icon: DotGridIcon },
  { value: "lines", label: "Ruled Lines", Icon: Rows3 },
  { value: "blank", label: "Blank (No Grid)", Icon: Square },
];

/**
 * The bottom pill: zoom controls, fit-to-screen, reset view, and the
 * background pattern picker — matching the reference's second, smaller
 * floating pill. Kept separate from the main Toolbar pill rather than one
 * long bar, same split the reference uses.
 */
export function BottomPill({
  zoomPercent, onZoomBy, onFitToContent, onResetView, backgroundPattern, onBackgroundPatternChange,
}: {
  zoomPercent: number;
  onZoomBy: (factor: number) => void;
  onFitToContent: () => void;
  onResetView: () => void;
  backgroundPattern: Pattern;
  onBackgroundPatternChange: (p: Pattern) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const ActivePatternIcon = PATTERN_OPTIONS.find((o) => o.value === backgroundPattern)?.Icon ?? Grid3x3;

  return (
    <div className="pointer-events-none absolute bottom-4 left-4 z-30">
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border bg-surface px-2 py-1.5 shadow-lg">
        <button
          type="button"
          onClick={() => onZoomBy(1 / 1.3)}
          title="Zoom out"
          className="flex shrink-0 items-center justify-center rounded-full p-2 text-fg-muted hover:bg-bg hover:text-fg"
        >
          <Minus size={16} />
        </button>
        <span className="w-11 shrink-0 text-center text-xs tabular-nums text-fg-muted">{zoomPercent}%</span>
        <button
          type="button"
          onClick={() => onZoomBy(1.3)}
          title="Zoom in"
          className="flex shrink-0 items-center justify-center rounded-full p-2 text-fg-muted hover:bg-bg hover:text-fg"
        >
          <Plus size={16} />
        </button>

        <div className="mx-1 h-6 w-px shrink-0 bg-border" />

        <button
          type="button"
          onClick={onFitToContent}
          title="Fit to content"
          className="flex shrink-0 items-center justify-center rounded-full p-2 text-fg-muted hover:bg-bg hover:text-fg"
        >
          <Maximize size={16} />
        </button>
        <button
          type="button"
          onClick={onResetView}
          title="Reset view"
          className="flex shrink-0 items-center justify-center rounded-full p-2 text-fg-muted hover:bg-bg hover:text-fg"
        >
          <Home size={16} />
        </button>

        <div className="mx-1 h-6 w-px shrink-0 bg-border" />

        <button
          ref={triggerRef}
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-pressed={menuOpen}
          title="Canvas background"
          className={`flex shrink-0 items-center justify-center rounded-full p-2 ${menuOpen ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-bg hover:text-fg"}`}
        >
          <ActivePatternIcon size={16} />
        </button>
        {menuOpen && (
          <ToolbarPopover anchorRef={triggerRef} onClose={() => setMenuOpen(false)} align="center">
            <div className="w-64 p-2">
              <div className="mb-1 px-2 pt-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">Canvas background grid</div>
              <div className="flex flex-col">
                {PATTERN_OPTIONS.map(({ value, label, Icon }) => {
                  const active = value === backgroundPattern;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => { onBackgroundPatternChange(value); setMenuOpen(false); }}
                      className={`flex items-center gap-3 rounded-md px-2 py-2 text-left text-sm ${
                        active ? "bg-accent/10 font-medium text-accent" : "text-fg hover:bg-bg"
                      }`}
                    >
                      <Icon size={18} />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </ToolbarPopover>
        )}
      </div>
    </div>
  );
}
