"use client";

import { ListChecks, Sparkles, Trash } from "lucide-react";
import type { Rect } from "@/lib/canvas/marquee";

/** Height the menu needs above the selection; any less room (the toolbar sits up there) and it goes below. */
const ROOM_ABOVE = 110;
/** Keeps the menu's middle this far from the canvas's left and right edges, so it isn't cut off. */
const HALF_WIDTH = 170;
const GAP = 10;

const BUTTON = "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm hover:bg-bg";

/**
 * A small floating menu over the current selection, Copilot-style: ask the
 * AI about it, have it checked, or delete it. `screen` is the selection's
 * box in screen pixels, relative to the canvas svg.
 */
export function SelectionMenu({
  screen, canvasWidth, onAsk, onCheck, onDelete,
}: {
  screen: Rect;
  canvasWidth: number;
  onAsk: () => void;
  onCheck: () => void;
  onDelete: () => void;
}) {
  const below = screen.minY < ROOM_ABOVE;
  const left = Math.min(Math.max((screen.minX + screen.maxX) / 2, HALF_WIDTH), Math.max(HALF_WIDTH, canvasWidth - HALF_WIDTH));
  return (
    <div
      data-testid="selection-menu"
      className="absolute z-30 flex w-max items-center gap-0.5 rounded-full border border-border bg-surface px-1.5 py-1 shadow-lg"
      style={{
        left,
        top: below ? screen.maxY + GAP : screen.minY - GAP,
        transform: below ? "translateX(-50%)" : "translate(-50%, -100%)",
      }}
    >
      <button type="button" onClick={onAsk} className={`${BUTTON} text-fg`}>
        <Sparkles size={14} className="text-accent" /> Ask AI
      </button>
      <button type="button" onClick={onCheck} className={`${BUTTON} text-fg`}>
        <ListChecks size={14} className="text-accent" /> Check my work
      </button>
      <div className="mx-0.5 h-5 w-px bg-border" />
      <button type="button" onClick={onDelete} className={`${BUTTON} text-fg-muted hover:text-red-600 dark:hover:text-red-400`}>
        <Trash size={14} /> Delete
      </button>
    </div>
  );
}
