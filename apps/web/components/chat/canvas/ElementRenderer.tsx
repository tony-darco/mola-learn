"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import { Move, MoveDiagonal2, Pencil } from "lucide-react";
import type { MathfieldElement } from "mathlive";
import type { z } from "zod";
import type { canvasShapeKindSchema, CanvasElement } from "@mola/shared";
import { strokeToPolylinePath, strokeToSvgPath } from "@/lib/canvas/strokePath";
import { elementBounds } from "@/lib/canvas/marquee";

/** A single resize handle at the bottom-right corner — deliberately not one
 * per corner; a single, always-in-the-same-place handle is a simpler,
 * steadier target than four. It stays visible even while typing (rendered
 * regardless of `editing`), so the moment you stop and move the mouse
 * there's already something to grab, instead of the affordance appearing
 * only after you click away first. */
function ResizeHandle({ element }: { element: { id: string; x: number; y: number; width: number; height: number } }) {
  return (
    <foreignObject x={element.x + element.width - 12} y={element.y + element.height - 12} width={24} height={24}>
      <div
        data-resize-handle="se"
        data-element-id={element.id}
        title="Drag to resize"
        className="flex h-6 w-6 cursor-nwse-resize items-center justify-center rounded-full border border-border bg-surface text-fg-muted shadow active:cursor-nwse-resize"
      >
        <MoveDiagonal2 size={12} />
      </div>
    </foreignObject>
  );
}

/** A small pencil badge that fades in on hover over a committed (non-editing)
 * text/note box — click it to re-enter edit mode, matching the "on hover
 * show a pencil" request. */
function EditBadge({ element, onStartEdit }: { element: { id: string; x: number; y: number; width: number }; onStartEdit: (id: string) => void }) {
  return (
    <foreignObject
      x={element.x + element.width - 12} y={element.y - 12} width={24} height={24}
      className="pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100"
    >
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onStartEdit(element.id); }}
        className="flex h-6 w-6 items-center justify-center rounded-full border border-border bg-surface text-fg-muted shadow hover:text-fg"
        title="Edit"
      >
        <Pencil size={12} />
      </button>
    </foreignObject>
  );
}

/** An explicit drag affordance on a selected box — carries data-element-id
 * so the same pointerdown hit-testing in CanvasView treats grabbing it
 * exactly like grabbing the box's body (select + drag), just with a
 * discoverable handle instead of relying on clicking the text itself. */
function DragHandle({ element }: { element: { id: string; x: number; y: number } }) {
  return (
    <foreignObject x={element.x - 12} y={element.y - 12} width={24} height={24}>
      <div
        data-element-id={element.id}
        title="Drag to move"
        className="flex h-6 w-6 cursor-grab items-center justify-center rounded-full border border-border bg-surface text-fg-muted shadow active:cursor-grabbing"
      >
        <Move size={12} />
      </div>
    </foreignObject>
  );
}

function dashArray(dash: "solid" | "dashed" | "dotted", strokeWidth: number): string | undefined {
  if (dash === "solid") return undefined;
  if (dash === "dashed") return `${strokeWidth * 3} ${strokeWidth * 2}`;
  // A near-zero dash length collapses each mark to a point — combined with
  // the round linecap every dashed/dotted element sets, that point renders
  // as a filled circle. A dash length equal to strokeWidth (the old value)
  // instead drew an elongated rounded-rectangle segment indistinguishable
  // from a short dash — dotted and dashed looked identical.
  return `0.1 ${strokeWidth * 2}`;
}

function starPoints(cx: number, cy: number, outerR: number, innerR: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return points.join(" ");
}

/** Arrowhead geometry shared by the line tool's optional start/end arrows. */
function arrowHeadPoints(tipX: number, tipY: number, dirX: number, dirY: number, size: number): string {
  const angle = Math.atan2(dirY, dirX);
  const a1 = angle + Math.PI - Math.PI / 6;
  const a2 = angle + Math.PI + Math.PI / 6;
  return `${tipX},${tipY} ${tipX + size * Math.cos(a1)},${tipY + size * Math.sin(a1)} ${tipX + size * Math.cos(a2)},${tipY + size * Math.sin(a2)}`;
}

type ShapeKind = z.infer<typeof canvasShapeKindSchema>;

/** The shape tool's live drag preview — same outline geometry as the
 * committed shape, unfilled and dashed. Reused here so the preview always
 * matches the currently-selected shape kind instead of defaulting to a
 * rectangle regardless of what's actually about to be placed. */
export function ShapeOutline({
  shapeKind, x, y, width, height,
}: { shapeKind: ShapeKind; x: number; y: number; width: number; height: number }) {
  const cx = x + width / 2, cy = y + height / 2;
  const common = { fill: "none", className: "stroke-accent", strokeWidth: 1.5, strokeDasharray: "4 3" };
  if (shapeKind === "rectangle") return <rect x={x} y={y} width={width} height={height} {...common} />;
  if (shapeKind === "ellipse") return <ellipse cx={cx} cy={cy} rx={width / 2} ry={height / 2} {...common} />;
  if (shapeKind === "triangle") return <polygon points={`${cx},${y} ${x},${y + height} ${x + width},${y + height}`} {...common} />;
  return <polygon points={starPoints(cx, cy, Math.min(width, height) / 2, Math.min(width, height) / 4.5)} {...common} />;
}

/** Screen pixels: the outline's stroke, and its gap from the element. */
const OUTLINE_WIDTH = 1.25;
const OUTLINE_PAD = 4;

/**
 * The selected state for every element without one of its own (frames and
 * sticky notes draw theirs): a thin dashed accent box around its bounds, the
 * same width on screen at any zoom. Ink drawn past the bounds — a stroke's
 * width, an arrowhead — is padded around, not cut through.
 */
export function SelectionOutline({ element, zoom }: { element: CanvasElement; zoom: number }) {
  const b = elementBounds(element);
  let ink = 0;
  if (element.type === "draw") ink = (element.props.strokeWidth * (element.props.variant === "highlighter" ? 3 : 1)) / 2;
  if (element.type === "shape") ink = element.props.strokeWidth / 2;
  if (element.type === "line") {
    const { strokeWidth, startArrow, endArrow } = element.props;
    // Half the arrowhead's size (see ElementShape's line branch).
    ink = startArrow || endArrow ? Math.max(strokeWidth * 2, 6) : strokeWidth / 2;
  }
  const pad = ink + OUTLINE_PAD / zoom;
  return (
    <rect
      data-testid="selection-outline"
      data-outline-for={element.id}
      x={b.minX - pad} y={b.minY - pad} width={b.maxX - b.minX + 2 * pad} height={b.maxY - b.minY + 2 * pad}
      fill="none" className="stroke-accent" strokeWidth={OUTLINE_WIDTH / zoom} strokeDasharray={`${4 / zoom} ${3 / zoom}`}
      pointerEvents="none"
    />
  );
}

export function ElementShape({
  element, selected, soleSelected, editing, onCommitText, onCommitMath, onMeasureMath, onRenameFrame, onStartEdit, zoom,
}: {
  element: CanvasElement; selected: boolean; soleSelected: boolean; editing: boolean;
  onCommitText: (id: string, text: string, contentHeight: number) => void;
  onCommitMath: (id: string, latex: string) => void;
  onMeasureMath: (id: string, width: number, height: number) => void;
  onRenameFrame: (id: string, name: string) => void;
  onStartEdit: (id: string) => void;
  /** Current pan/zoom scale — text/note boxes need it to convert a live,
   * screen-pixel content-height reading into world units while typing. */
  zoom: number;
}) {
  if (element.type === "draw") return <DrawShape element={element} />;

  if (element.type === "line") {
    const x1 = element.x, y1 = element.y;
    const x2 = element.x + element.props.endX, y2 = element.y + element.props.endY;
    const dx = x2 - x1, dy = y2 - y1;
    // A head only ~2.5x the shaft width read as thin/undersized next to a
    // thicker line — bumped so the arrowhead stays visually bold at every
    // stroke width, not just the thinnest ones (where the 8px floor used
    // to do most of the work anyway).
    const headSize = Math.max(element.props.strokeWidth * 4, 12);
    return (
      <g data-element-id={element.id} opacity={element.opacity}>
        {/* A thin line is a hard target to click precisely — this invisible,
            wider stroke gives it a generous hit area without affecting how
            it looks. */}
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={Math.max(element.props.strokeWidth, 16)} strokeLinecap="round" />
        <line
          x1={x1} y1={y1} x2={x2} y2={y2}
          stroke={element.props.color} strokeWidth={element.props.strokeWidth}
          strokeDasharray={dashArray(element.props.dash, element.props.strokeWidth)}
          strokeLinecap="round"
        />
        {element.props.endArrow && (
          <polygon points={arrowHeadPoints(x2, y2, dx, dy, headSize)} fill={element.props.color} />
        )}
        {element.props.startArrow && (
          <polygon points={arrowHeadPoints(x1, y1, -dx, -dy, headSize)} fill={element.props.color} />
        )}
      </g>
    );
  }

  if (element.type === "shape") {
    const fillId = `fill-${element.id}`;
    const hasPattern = element.props.fillStyle === "hachure" || element.props.fillStyle === "crosshatch";
    const fill =
      element.props.fillStyle === "none" ? "none"
      : element.props.fillStyle === "solid" ? (element.props.fillColor ?? element.props.color)
      : `url(#${fillId})`;
    const { x, y, width, height } = element;
    const cx = x + width / 2, cy = y + height / 2;

    return (
      <g data-element-id={element.id} opacity={element.opacity}>
        {/* An unfilled shape (fill="none") only catches pointer events on
            its stroke, not its interior — this invisible full-bbox rect
            makes the whole shape clickable/draggable regardless of fill. */}
        <rect x={x} y={y} width={width} height={height} fill="transparent" />
        {hasPattern && (
          <defs>
            <pattern id={fillId} width={6} height={6} patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
              <line x1={0} y1={0} x2={0} y2={6} stroke={element.props.fillColor ?? element.props.color} strokeWidth={1.5} />
              {element.props.fillStyle === "crosshatch" && (
                <line x1={0} y1={0} x2={6} y2={0} stroke={element.props.fillColor ?? element.props.color} strokeWidth={1.5} />
              )}
            </pattern>
          </defs>
        )}
        {element.props.shapeKind === "rectangle" && (
          <rect x={x} y={y} width={width} height={height} fill={fill} stroke={element.props.color} strokeWidth={element.props.strokeWidth} strokeDasharray={dashArray(element.props.dash, element.props.strokeWidth)} strokeLinecap="round" strokeLinejoin="round" />
        )}
        {element.props.shapeKind === "ellipse" && (
          <ellipse cx={cx} cy={cy} rx={width / 2} ry={height / 2} fill={fill} stroke={element.props.color} strokeWidth={element.props.strokeWidth} strokeDasharray={dashArray(element.props.dash, element.props.strokeWidth)} strokeLinecap="round" />
        )}
        {element.props.shapeKind === "triangle" && (
          <polygon points={`${cx},${y} ${x},${y + height} ${x + width},${y + height}`} fill={fill} stroke={element.props.color} strokeWidth={element.props.strokeWidth} strokeDasharray={dashArray(element.props.dash, element.props.strokeWidth)} strokeLinecap="round" strokeLinejoin="round" />
        )}
        {element.props.shapeKind === "star" && (
          <polygon points={starPoints(cx, cy, Math.min(width, height) / 2, Math.min(width, height) / 4.5)} fill={fill} stroke={element.props.color} strokeWidth={element.props.strokeWidth} strokeDasharray={dashArray(element.props.dash, element.props.strokeWidth)} strokeLinecap="round" strokeLinejoin="round" />
        )}
      </g>
    );
  }

  if (element.type === "image") {
    return (
      <image
        data-element-id={element.id}
        href={element.props.url}
        x={element.x} y={element.y} width={element.width} height={element.height}
        opacity={element.opacity}
        preserveAspectRatio="xMidYMid slice"
      />
    );
  }

  if (element.type === "note") {
    return (
      <NoteShape
        element={element} editing={editing} selected={selected} soleSelected={soleSelected}
        onCommitText={onCommitText} onStartEdit={onStartEdit} zoom={zoom}
      />
    );
  }

  if (element.type === "math") {
    return <MathShape element={element} editing={editing} onCommit={onCommitMath} onMeasure={onMeasureMath} />;
  }

  if (element.type === "frame") {
    return (
      <g data-element-id={element.id} opacity={element.opacity}>
        <rect
          x={element.x} y={element.y} width={element.width} height={element.height}
          fill="none" stroke={selected ? "var(--accent)" : "var(--border)"} strokeWidth={selected ? 2 : 1.5} strokeDasharray="4 3"
        />
        {selected ? (
          <foreignObject x={element.x} y={element.y - 22} width={Math.max(element.width, 100)} height={20}>
            <input
              defaultValue={element.props.name}
              onBlur={(e) => onRenameFrame(element.id, e.target.value || "Untitled frame")}
              className="w-full border-none bg-transparent text-xs text-fg-muted outline-none"
            />
          </foreignObject>
        ) : (
          <text x={element.x} y={element.y - 6} className="fill-fg-muted text-[11px]">{element.props.name}</text>
        )}
      </g>
    );
  }

  // text
  return (
    <TextShape
      element={element} editing={editing} soleSelected={soleSelected}
      onCommitText={onCommitText} onStartEdit={onStartEdit} zoom={zoom}
    />
  );
}

/**
 * Text and note boxes in "grow" autofit mode need to visually grow while
 * the user is still typing, not just on commit — otherwise the box (and
 * for a colored box, its own background) stays clipped at its old height
 * for the whole gesture and only jumps to the right size on blur. Kept as
 * its own component (like DrawShape/MathShape below) because it owns hooks
 * that ElementShape's own early-return branches can't host directly.
 */
function TextShape({
  element, editing, soleSelected, onCommitText, onStartEdit, zoom,
}: {
  element: Extract<CanvasElement, { type: "text" }>; editing: boolean; soleSelected: boolean;
  onCommitText: (id: string, text: string, contentHeight: number) => void;
  onStartEdit: (id: string) => void;
  zoom: number;
}) {
  const [liveHeight, setLiveHeight] = useState(element.height);
  useEffect(() => setLiveHeight(element.height), [element.height]);
  const isGrowing = editing && element.props.autoFit === "grow";
  const displayHeight = isGrowing ? Math.max(liveHeight, element.height) : element.height;

  return (
    <g data-element-id={element.id} opacity={element.opacity} className="group">
      <foreignObject x={element.x} y={element.y} width={element.width} height={displayHeight}>
        <InlineText
          text={element.props.text} color={element.props.color} editing={editing}
          backgroundColor={element.props.backgroundColor} bold={element.props.bold} italic={element.props.italic}
          fontSize={element.props.fontSize} textAlign={element.props.textAlign}
          onCommit={(t, h) => onCommitText(element.id, t, h)}
          onLiveHeightChange={isGrowing ? (px) => setLiveHeight(px / zoom) : undefined}
        />
      </foreignObject>
      {!editing && <EditBadge element={element} onStartEdit={onStartEdit} />}
      {soleSelected && <ResizeHandle element={element} />}
      {soleSelected && !editing && <DragHandle element={element} />}
    </g>
  );
}

function NoteShape({
  element, editing, selected, soleSelected, onCommitText, onStartEdit, zoom,
}: {
  element: Extract<CanvasElement, { type: "note" }>; editing: boolean; selected: boolean; soleSelected: boolean;
  onCommitText: (id: string, text: string, contentHeight: number) => void;
  onStartEdit: (id: string) => void;
  zoom: number;
}) {
  const [liveHeight, setLiveHeight] = useState(element.height);
  useEffect(() => setLiveHeight(element.height), [element.height]);
  const isGrowing = editing && element.props.autoFit === "grow";
  const displayHeight = isGrowing ? Math.max(liveHeight, element.height) : element.height;

  return (
    <g data-element-id={element.id} opacity={element.opacity} className="group">
      <rect x={element.x} y={element.y} width={element.width} height={displayHeight} rx={6} fill={element.props.color} className={selected ? "stroke-accent" : ""} strokeWidth={selected ? 2 : 0} />
      <foreignObject x={element.x} y={element.y} width={element.width} height={displayHeight}>
        <InlineText
          text={element.props.text} color={element.props.textColor} editing={editing}
          bold={element.props.bold} italic={element.props.italic} fontSize={element.props.fontSize}
          textAlign={element.props.textAlign}
          onCommit={(t, h) => onCommitText(element.id, t, h)} padded
          onLiveHeightChange={isGrowing ? (px) => setLiveHeight(px / zoom) : undefined}
        />
      </foreignObject>
      {!editing && <EditBadge element={element} onStartEdit={onStartEdit} />}
      {soleSelected && <ResizeHandle element={element} />}
      {soleSelected && !editing && <DragHandle element={element} />}
    </g>
  );
}

/**
 * The outline path is a pure function of `points`, but perfect-freehand's
 * spacing/taper math leans on sqrt/atan2 — IEEE754 guarantees determinism
 * for +,-,*,/ but not for transcendental functions, whose last-bit result
 * can legitimately differ between Node's V8 (SSR) and the browser's V8
 * (hydration), producing a real but harmless server/client `d` mismatch.
 * Rather than fight that, the path is left empty through the render that
 * has to match SSR (mount === false) and computed only afterward, as an
 * ordinary post-hydration state update — never during hydration itself.
 */
function DrawShape({ element }: { element: Extract<CanvasElement, { type: "draw" }> }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isHighlighter = element.props.variant === "highlighter";
  const opacity = isHighlighter ? element.opacity * 0.4 : element.opacity;
  const isDashed = element.props.dash !== "solid";

  // Both hooks run unconditionally every render (Rules of Hooks) — each
  // only does real work when its branch below is the one actually used.
  const outlineD = useMemo(() => (mounted && !isDashed ? strokeToSvgPath(element.props) : ""), [element.props, mounted, isDashed]);
  const polylineD = useMemo(() => (isDashed ? strokeToPolylinePath(element.props.points) : ""), [element.props, isDashed]);

  // Dashed/dotted skip the tapered perfect-freehand outline entirely — a
  // stroked polyline with stroke-dasharray, same as the line/shape tools.
  if (isDashed) {
    return (
      <path
        data-element-id={element.id}
        d={polylineD}
        transform={`translate(${element.x},${element.y})`}
        fill="none"
        stroke={element.props.color}
        strokeWidth={element.props.strokeWidth}
        strokeDasharray={dashArray(element.props.dash, element.props.strokeWidth)}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={opacity}
        style={isHighlighter ? { mixBlendMode: "multiply" } : undefined}
      />
    );
  }

  return (
    <path
      data-element-id={element.id}
      d={outlineD}
      transform={`translate(${element.x},${element.y})`}
      fill={element.props.color}
      opacity={opacity}
      style={isHighlighter ? { mixBlendMode: "multiply" } : undefined}
    />
  );
}

/** Breathing room around a formula inside its box, in canvas units. */
const MATH_PAD = 6;

function MathShape({
  element, editing, onCommit, onMeasure,
}: {
  element: Extract<CanvasElement, { type: "math" }>; editing: boolean;
  onCommit: (id: string, latex: string) => void;
  /** Reports the box size the rendered formula actually needs, when it differs from the stored one. */
  onMeasure: (id: string, width: number, height: number) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const html = useMemo(
    () => (mounted ? katex.renderToString(element.props.latex || "\\,", { throwOnError: false }) : ""),
    [element.props.latex, mounted],
  );
  // React 19 re-sets innerHTML whenever this object is new, even with an
  // identical string — which rebuilt the formula's DOM on every re-render,
  // including the one selecting it on pointerdown. The node under the
  // pointer vanished before pointerup, so the browser never fired click or
  // dblclick, and double-click-to-edit silently did nothing.
  const innerHtml = useMemo(() => ({ __html: html }), [html]);

  const [ready, setReady] = useState(false);
  const fieldRef = useRef<MathfieldElement | null>(null);

  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    import("mathlive").then(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [editing]);

  useEffect(() => {
    if (!editing || !ready || !fieldRef.current) return;
    fieldRef.current.value = element.props.latex;
    fieldRef.current.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- set once when the editor opens, not on every keystroke.
  }, [editing, ready]);

  // While editing, the box grows with what's being typed instead of clipping it.
  const [editorSize, setEditorSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const field = fieldRef.current;
    if (!editing || !ready || !field) return;
    const measure = () => setEditorSize({ width: field.offsetWidth, height: field.offsetHeight });
    measure();
    field.addEventListener("input", measure);
    return () => field.removeEventListener("input", measure);
  }, [editing, ready]);

  // A committed formula's box is exactly what KaTeX draws — a matrix or a
  // long equation needs more than the 160×40 a new math element starts at —
  // so it's never clipped, and selection sees its real extent.
  // offsetWidth/Height are layout sizes, untouched by the canvas's pan/zoom
  // transform, so they're already in canvas units. Measured again once web
  // fonts load, since KaTeX's metrics change when its fonts arrive.
  const contentRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (editing || !html) return;
    let cancelled = false;
    const measure = () => {
      const content = contentRef.current;
      if (cancelled || !content) return;
      const width = content.offsetWidth + MATH_PAD * 2;
      const height = content.offsetHeight + MATH_PAD * 2;
      if (Math.abs(width - element.width) > 1 || Math.abs(height - element.height) > 1) onMeasure(element.id, width, height);
    };
    measure();
    document.fonts?.ready.then(measure);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-measure only when what's drawn changes, not after our own resize.
  }, [editing, html, element.props.fontSize]);

  if (editing) {
    return (
      <foreignObject
        data-element-id={element.id} x={element.x} y={element.y}
        width={Math.max(element.width, 140, editorSize.width + 4)} height={Math.max(element.height, 40, editorSize.height + 4)}
      >
        {ready ? (
          <math-field
            ref={fieldRef as unknown as React.RefObject<HTMLElement>}
            onBlur={() => onCommit(element.id, fieldRef.current?.value ?? element.props.latex)}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Escape") (e.target as HTMLElement).blur(); }}
            className="inline-block min-w-[140px] rounded border border-accent bg-surface px-1.5 py-1 text-base"
          />
        ) : (
          <div className="text-xs text-fg-muted">Loading…</div>
        )}
      </foreignObject>
    );
  }

  return (
    <foreignObject data-element-id={element.id} x={element.x} y={element.y} width={element.width} height={element.height} opacity={element.opacity}>
      <div
        className="flex h-full items-center"
        style={{ color: element.props.color, fontSize: element.props.fontSize, padding: `0 ${MATH_PAD}px` }}
      >
        <div ref={contentRef} className="inline-block whitespace-nowrap" dangerouslySetInnerHTML={innerHtml} />
      </div>
    </foreignObject>
  );
}

function InlineText({
  text, color, editing, onCommit, padded, backgroundColor, bold, italic, fontSize, textAlign, onLiveHeightChange,
}: {
  text: string; color: string; editing: boolean;
  /** contentHeight is the textarea's own scrollHeight in *screen* pixels at
   * commit time — the caller converts it to world units (divide by the
   * current zoom) before persisting, since this component has no notion of
   * pan/zoom. */
  onCommit: (text: string, contentHeight: number) => void;
  padded?: boolean;
  backgroundColor?: string | null; bold?: boolean; italic?: boolean; fontSize?: number;
  textAlign?: "left" | "center" | "right";
  /** Fires on every keystroke (screen px, same units as onCommit's
   * contentHeight) — lets the caller grow the box in real time instead of
   * only once on blur. Omitted entirely outside "grow" autofit mode. */
  onLiveHeightChange?: (contentHeight: number) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing && ref.current) { ref.current.focus(); autoGrow(ref.current); }
  }, [editing]);

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    onLiveHeightChange?.(el.scrollHeight);
  }

  const textStyle: React.CSSProperties = {
    color,
    backgroundColor: backgroundColor ?? undefined,
    fontWeight: bold ? 700 : 400,
    fontStyle: italic ? "italic" : "normal",
    fontSize,
    textAlign,
  };

  if (!editing) {
    return (
      <div className={`h-full w-full whitespace-pre-wrap text-sm ${padded ? "p-2" : "rounded px-1.5 py-1"}`} style={textStyle}>
        {text || <span className="italic text-fg-muted">empty</span>}
      </div>
    );
  }

  return (
    <textarea
      ref={ref}
      defaultValue={text}
      style={textStyle}
      className={`w-full resize-none overflow-hidden border border-accent bg-surface text-sm outline-none ${padded ? "rounded-md p-2" : "rounded px-1.5 py-1"}`}
      onInput={(e) => autoGrow(e.currentTarget)}
      onBlur={(e) => onCommit(e.currentTarget.value, e.currentTarget.scrollHeight)}
      onKeyDown={(e) => { if (e.key === "Escape") e.currentTarget.blur(); }}
    />
  );
}
