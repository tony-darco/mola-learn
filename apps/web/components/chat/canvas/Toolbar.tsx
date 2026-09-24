"use client";

import { useRef, useState } from "react";
import type { z } from "zod";
import type { canvasShapeKindSchema } from "@mola/shared";
import type { WidthCategory } from "@/lib/canvas/styleConstants";

export type Tool =
  | "select" | "pan" | "draw" | "highlighter" | "line" | "arrow" | "shape"
  | "text" | "note" | "eraser" | "math" | "frame" | "laser";
export type ShapeKind = z.infer<typeof canvasShapeKindSchema>;
export type EraserMode = "standard" | "stroke";

const SHAPE_KINDS: ShapeKind[] = ["rectangle", "ellipse", "triangle", "star"];

const TOOL_LABEL: Record<Tool, string> = {
  select: "Select", pan: "Pan", draw: "Pen", highlighter: "Marker", line: "Line", arrow: "Arrow",
  shape: "Shape", text: "Text", note: "Note", eraser: "Eraser", math: "∑", frame: "Frame", laser: "Laser",
};

/**
 * Every tool button in one row, in the order requested: select/pan, lock,
 * pen/highlighter/line/arrow/shape, text/note, eraser, undo/redo, math,
 * frame, laser, image upload, clear canvas. Tables are deliberately not
 * here — deferred to a separate follow-up pass.
 */
export function Toolbar({
  tool, onToolChange, locked, onLockedChange, shapeKind, onShapeKindChange,
  eraserMode, onEraserModeChange, eraserSize, onEraserSizeChange, canUndo, canRedo, onUndo, onRedo,
  onUploadImage, onClearCanvas, onZoomBy,
}: {
  tool: Tool; onToolChange: (t: Tool) => void;
  locked: boolean; onLockedChange: (v: boolean) => void;
  shapeKind: ShapeKind; onShapeKindChange: (k: ShapeKind) => void;
  eraserMode: EraserMode; onEraserModeChange: (m: EraserMode) => void;
  eraserSize: WidthCategory; onEraserSizeChange: (s: WidthCategory) => void;
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void;
  onUploadImage: (file: File) => void; onClearCanvas: () => void; onZoomBy: (factor: number) => void;
}) {
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const [eraserMenuOpen, setEraserMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function toolButton(t: Tool, extraClass = "") {
    return (
      <button
        key={t}
        type="button"
        onClick={() => onToolChange(t)}
        aria-pressed={tool === t}
        title={TOOL_LABEL[t]}
        className={`rounded-md px-2.5 py-1 text-sm ${tool === t ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-bg"} ${extraClass}`}
      >
        {TOOL_LABEL[t]}
      </button>
    );
  }

  return (
    <div className="flex flex-nowrap items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-border bg-surface px-3 py-2">
      {toolButton("select")}
      {toolButton("pan")}
      <button
        type="button"
        onClick={() => onLockedChange(!locked)}
        aria-pressed={locked}
        title="Keep the current tool active after each use"
        className={`rounded-md px-2 py-1 text-sm ${locked ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-bg"}`}
      >
        {locked ? "Lock" : "Unlock"}
      </button>
      <div className="mx-1 h-5 w-px bg-border" />

      {toolButton("draw")}
      {toolButton("highlighter")}
      {toolButton("line")}
      {toolButton("arrow")}

      <div className="relative">
        <button
          type="button"
          onClick={() => { onToolChange("shape"); setShapeMenuOpen((o) => !o); }}
          aria-pressed={tool === "shape"}
          className={`rounded-md px-2.5 py-1 text-sm ${tool === "shape" ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-bg"}`}
        >
          {shapeKind[0]!.toUpperCase() + shapeKind.slice(1)} ▾
        </button>
        {shapeMenuOpen && (
          <div className="absolute left-0 top-full z-20 mt-1 flex flex-col rounded-md border border-border bg-surface py-1 shadow-lg">
            {SHAPE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => { onShapeKindChange(k); onToolChange("shape"); setShapeMenuOpen(false); }}
                className="px-3 py-1 text-left text-sm capitalize text-fg hover:bg-bg"
              >
                {k}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mx-1 h-5 w-px bg-border" />
      {toolButton("text")}
      {toolButton("note")}

      <div className="relative">
        <button
          type="button"
          onClick={() => { onToolChange("eraser"); setEraserMenuOpen((o) => !o); }}
          aria-pressed={tool === "eraser"}
          className={`rounded-md px-2.5 py-1 text-sm ${tool === "eraser" ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-bg"}`}
        >
          Eraser ▾
        </button>
        {eraserMenuOpen && (
          <div className="absolute left-0 top-full z-20 mt-1 flex w-56 flex-col gap-2 rounded-md border border-border bg-surface p-2 shadow-lg">
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
        )}
      </div>

      <div className="mx-1 h-5 w-px bg-border" />
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo"
        className="rounded-md px-2 py-1 text-sm text-fg-muted hover:bg-bg disabled:cursor-default disabled:opacity-40"
      >
        ↶
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo"
        className="rounded-md px-2 py-1 text-sm text-fg-muted hover:bg-bg disabled:cursor-default disabled:opacity-40"
      >
        ↷
      </button>

      <div className="mx-1 h-5 w-px bg-border" />
      {toolButton("math")}
      {toolButton("frame")}
      {toolButton("laser")}

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        title="Upload image"
        className="rounded-md px-2.5 py-1 text-sm text-fg-muted hover:bg-bg"
      >
        Image
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
        className="rounded-md px-2.5 py-1 text-sm text-fg-muted hover:bg-bg"
      >
        Clear
      </button>

      <div className="ml-auto flex items-center gap-1">
        <button type="button" onClick={() => onZoomBy(1.3)} className="rounded-md border border-border px-2 py-1 text-sm hover:bg-bg">+</button>
        <button type="button" onClick={() => onZoomBy(1 / 1.3)} className="rounded-md border border-border px-2 py-1 text-sm hover:bg-bg">−</button>
      </div>
    </div>
  );
}
