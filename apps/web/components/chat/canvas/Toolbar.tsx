"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { z } from "zod";
import type { canvasShapeKindSchema } from "@mola/shared";
import {
  ArrowUpRight, ChevronDown, Circle, Eraser, Frame, Hand, Highlighter, ImagePlus,
  Lock, MousePointer2, Pencil, Redo2, Sigma, Slash, Square, Star, StickyNote, Target,
  Triangle, Trash2, Type, Undo2, Unlock,
} from "lucide-react";
import type { WidthCategory } from "@/lib/canvas/styleConstants";

export type Tool =
  | "select" | "pan" | "draw" | "highlighter" | "line" | "arrow" | "shape"
  | "text" | "note" | "eraser" | "math" | "frame" | "laser";
export type ShapeKind = z.infer<typeof canvasShapeKindSchema>;
export type EraserMode = "standard" | "stroke";

const SHAPE_KINDS: ShapeKind[] = ["rectangle", "ellipse", "triangle", "star"];
const GAP = 8;

const SHAPE_ICON: Record<ShapeKind, typeof Square> = {
  rectangle: Square, ellipse: Circle, triangle: Triangle, star: Star,
};

const TOOL_LABEL: Record<Tool, string> = {
  select: "Select", pan: "Pan", draw: "Pen", highlighter: "Marker", line: "Line", arrow: "Arrow",
  shape: "Shape", text: "Text", note: "Sticky note", eraser: "Eraser", math: "Math", frame: "Frame", laser: "Laser pointer",
};

/**
 * Floats `children` under `anchorRef` via a portal into <body>, positioned
 * with `position: fixed` from the trigger's live bounding rect — the same
 * pattern ChatContextMenu.tsx uses. Anything positioned `absolute` inside
 * a floating pill's own layout gets clipped by the pill's rounded/overflow
 * bounds, so a plain in-flow dropdown looked "stuck behind" the canvas.
 * Escaping to a portal sidesteps that ancestor, present or future.
 */
function ToolbarPopover({
  anchorRef, onClose, children, align = "start",
}: { anchorRef: React.RefObject<HTMLElement | null>; onClose: () => void; children: React.ReactNode; align?: "start" | "center" }) {
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    // The bottom pill's triggers sit near the bottom edge, where "open
    // below" would render off-screen — flip to opening upward when the
    // trigger is past the viewport's midpoint, same as ChatContextMenu.
    const openUpward = rect.top > window.innerHeight / 2;
    const left = align === "center" ? rect.left + rect.width / 2 : rect.left;
    setPos(openUpward ? { bottom: window.innerHeight - rect.top + GAP, left } : { top: rect.bottom + GAP, left });
  }, [anchorRef, align]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    function handleScroll() { onClose(); }
    document.addEventListener("scroll", handleScroll, true);
    function handleKeyDown(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("scroll", handleScroll, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!pos) return null;

  return createPortal(
    <div
      ref={popoverRef}
      style={{ position: "fixed", top: pos.top, bottom: pos.bottom, left: pos.left, transform: align === "center" ? "translateX(-50%)" : undefined }}
      className="z-50 rounded-lg border border-border bg-surface shadow-lg"
    >
      {children}
    </div>,
    document.body,
  );
}

function Divider() {
  return <div className="mx-1 h-6 w-px shrink-0 bg-border" />;
}

/**
 * The main tool pill — a detached, floating bar (not flush against the
 * canvas edge) with icon-only buttons, matching the reference toolbar.
 * Tables are deliberately not here — deferred to a separate follow-up pass.
 */
export function Toolbar({
  tool, onToolChange, locked, onLockedChange, shapeKind, onShapeKindChange,
  eraserMode, onEraserModeChange, eraserSize, onEraserSizeChange, canUndo, canRedo, onUndo, onRedo,
  onUploadImage, onClearCanvas,
}: {
  tool: Tool; onToolChange: (t: Tool) => void;
  locked: boolean; onLockedChange: (v: boolean) => void;
  shapeKind: ShapeKind; onShapeKindChange: (k: ShapeKind) => void;
  eraserMode: EraserMode; onEraserModeChange: (m: EraserMode) => void;
  eraserSize: WidthCategory; onEraserSizeChange: (s: WidthCategory) => void;
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void;
  onUploadImage: (file: File) => void; onClearCanvas: () => void;
}) {
  // A single slot for "which dropdown is open" — opening one always closes
  // the other, instead of each button tracking its own independent boolean.
  const [openMenu, setOpenMenu] = useState<"shape" | "eraser" | null>(null);
  const shapeTriggerRef = useRef<HTMLButtonElement>(null);
  const eraserTriggerRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function iconButton(t: Tool, Icon: React.ComponentType<{ size?: number; className?: string }>) {
    const isActiveLaser = t === "laser" && tool === "laser";
    return (
      <button
        key={t}
        type="button"
        onClick={() => { onToolChange(t); setOpenMenu(null); }}
        aria-pressed={tool === t}
        title={TOOL_LABEL[t]}
        className={`flex shrink-0 items-center justify-center rounded-full p-2 ${tool === t ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-bg hover:text-fg"}`}
      >
        {isActiveLaser ? <span className="block h-3.5 w-3.5 rounded-full bg-red-500" /> : <Icon size={18} />}
      </button>
    );
  }

  const ShapeTriggerIcon = SHAPE_ICON[shapeKind];

  return (
    <div className="pointer-events-none absolute left-1/2 top-4 z-30 -translate-x-1/2">
      <div className="pointer-events-auto flex max-w-[calc(100vw-32px)] items-center gap-0.5 overflow-x-auto rounded-full border border-border bg-surface px-2 py-1.5 shadow-lg">
        {iconButton("select", MousePointer2)}
        {iconButton("pan", Hand)}
        <button
          type="button"
          onClick={() => onLockedChange(!locked)}
          aria-pressed={locked}
          title={locked ? "Unlock: switch back to Select after each tool use" : "Lock: keep the current tool active after each use"}
          className={`flex shrink-0 items-center justify-center rounded-full p-2 ${locked ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-bg hover:text-fg"}`}
        >
          {locked ? <Lock size={18} /> : <Unlock size={18} />}
        </button>
        <Divider />

        {iconButton("draw", Pencil)}
        {iconButton("highlighter", Highlighter)}
        {iconButton("line", Slash)}
        {iconButton("arrow", ArrowUpRight)}

        <button
          ref={shapeTriggerRef}
          type="button"
          onClick={() => { onToolChange("shape"); setOpenMenu(openMenu === "shape" ? null : "shape"); }}
          aria-pressed={tool === "shape"}
          title="Shape"
          className={`flex shrink-0 items-center justify-center gap-0.5 rounded-full py-2 pl-2 pr-1 ${tool === "shape" ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-bg hover:text-fg"}`}
        >
          <ShapeTriggerIcon size={18} />
          <ChevronDown size={20} strokeWidth={2.5} />
        </button>
        {openMenu === "shape" && (
          <ToolbarPopover anchorRef={shapeTriggerRef} onClose={() => setOpenMenu(null)}>
            <div className="flex flex-col py-1">
              {SHAPE_KINDS.map((k) => {
                const Icon = SHAPE_ICON[k];
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => { onShapeKindChange(k); onToolChange("shape"); setOpenMenu(null); }}
                    className="flex items-center gap-2 px-3 py-1.5 text-left text-sm capitalize text-fg hover:bg-bg"
                  >
                    <Icon size={16} className="text-fg-muted" />
                    {k}
                  </button>
                );
              })}
            </div>
          </ToolbarPopover>
        )}

        <Divider />
        {iconButton("text", Type)}
        {iconButton("note", StickyNote)}

        <button
          ref={eraserTriggerRef}
          type="button"
          onClick={() => { onToolChange("eraser"); setOpenMenu(openMenu === "eraser" ? null : "eraser"); }}
          aria-pressed={tool === "eraser"}
          title="Eraser"
          className={`flex shrink-0 items-center justify-center gap-0.5 rounded-full py-2 pl-2 pr-1 ${tool === "eraser" ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-bg hover:text-fg"}`}
        >
          <Eraser size={18} />
          <ChevronDown size={20} strokeWidth={2.5} />
        </button>
        {openMenu === "eraser" && (
          <ToolbarPopover anchorRef={eraserTriggerRef} onClose={() => setOpenMenu(null)}>
            <div className="flex w-56 flex-col gap-2 p-2">
              <div className="flex flex-col">
                {(["standard", "stroke"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { onEraserModeChange(m); onToolChange("eraser"); }}
                    className={`rounded px-2 py-1 text-left text-sm hover:bg-bg ${eraserMode === m ? "text-accent" : "text-fg"}`}
                  >
                    {m === "standard" ? "Standard — erase part of a stroke" : "Stroke — erase the whole object"}
                  </button>
                ))}
              </div>
              <div className="flex gap-1 border-t border-border pt-2">
                {(["S", "M", "L", "XL"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onEraserSizeChange(s)}
                    className={`flex-1 rounded-md border px-2 py-1 text-xs ${
                      eraserSize === s ? "border-accent bg-accent text-accent-fg" : "border-border text-fg-muted hover:bg-bg"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </ToolbarPopover>
        )}

        <Divider />
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo"
          className="flex shrink-0 items-center justify-center rounded-full p-2 text-fg-muted hover:bg-bg hover:text-fg disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <Undo2 size={18} />
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo"
          className="flex shrink-0 items-center justify-center rounded-full p-2 text-fg-muted hover:bg-bg hover:text-fg disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <Redo2 size={18} />
        </button>

        <Divider />
        {iconButton("math", Sigma)}
        {iconButton("frame", Frame)}
        {iconButton("laser", Target)}

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Upload image"
          className="flex shrink-0 items-center justify-center rounded-full p-2 text-fg-muted hover:bg-bg hover:text-fg"
        >
          <ImagePlus size={18} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUploadImage(file);
            e.target.value = "";
          }}
        />

        <button
          type="button"
          onClick={onClearCanvas}
          title="Clear canvas"
          className="flex shrink-0 items-center justify-center rounded-full p-2 text-fg-muted hover:bg-bg hover:text-fg"
        >
          <Trash2 size={18} />
        </button>
      </div>
    </div>
  );
}

export { ToolbarPopover };
