"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import type { MathfieldElement } from "mathlive";
import type { CanvasElement } from "@mola/shared";
import { strokeToSvgPath } from "@/lib/canvas/strokePath";

function dashArray(dash: "solid" | "dashed" | "dotted", strokeWidth: number): string | undefined {
  if (dash === "solid") return undefined;
  if (dash === "dashed") return `${strokeWidth * 3} ${strokeWidth * 2}`;
  return `${strokeWidth} ${strokeWidth * 1.5}`;
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
  const a1 = angle + Math.PI - Math.PI / 7;
  const a2 = angle + Math.PI + Math.PI / 7;
  return `${tipX},${tipY} ${tipX + size * Math.cos(a1)},${tipY + size * Math.sin(a1)} ${tipX + size * Math.cos(a2)},${tipY + size * Math.sin(a2)}`;
}

export function ElementShape({
  element, selected, editing, onCommitText, onCommitMath, onRenameFrame,
}: {
  element: CanvasElement; selected: boolean; editing: boolean;
  onCommitText: (id: string, text: string) => void;
  onCommitMath: (id: string, latex: string) => void;
  onRenameFrame: (id: string, name: string) => void;
}) {
  if (element.type === "draw") return <DrawShape element={element} />;

  if (element.type === "line") {
    const x1 = element.x, y1 = element.y;
    const x2 = element.x + element.props.endX, y2 = element.y + element.props.endY;
    const dx = x2 - x1, dy = y2 - y1;
    const headSize = Math.max(element.props.strokeWidth * 2.5, 8);
    return (
      <g data-element-id={element.id} opacity={element.opacity}>
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
          <rect x={x} y={y} width={width} height={height} fill={fill} stroke={element.props.color} strokeWidth={element.props.strokeWidth} strokeDasharray={dashArray(element.props.dash, element.props.strokeWidth)} />
        )}
        {element.props.shapeKind === "ellipse" && (
          <ellipse cx={cx} cy={cy} rx={width / 2} ry={height / 2} fill={fill} stroke={element.props.color} strokeWidth={element.props.strokeWidth} strokeDasharray={dashArray(element.props.dash, element.props.strokeWidth)} />
        )}
        {element.props.shapeKind === "triangle" && (
          <polygon points={`${cx},${y} ${x},${y + height} ${x + width},${y + height}`} fill={fill} stroke={element.props.color} strokeWidth={element.props.strokeWidth} strokeDasharray={dashArray(element.props.dash, element.props.strokeWidth)} />
        )}
        {element.props.shapeKind === "star" && (
          <polygon points={starPoints(cx, cy, Math.min(width, height) / 2, Math.min(width, height) / 4.5)} fill={fill} stroke={element.props.color} strokeWidth={element.props.strokeWidth} strokeDasharray={dashArray(element.props.dash, element.props.strokeWidth)} />
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
      <g data-element-id={element.id} opacity={element.opacity}>
        <rect x={element.x} y={element.y} width={element.width} height={element.height} rx={6} fill={element.props.color} className={selected ? "stroke-accent" : ""} strokeWidth={selected ? 2 : 0} />
        <foreignObject x={element.x} y={element.y} width={element.width} height={element.height}>
          <InlineText
            text={element.props.text} color={element.props.textColor} editing={editing}
            onCommit={(t) => onCommitText(element.id, t)} padded
          />
        </foreignObject>
      </g>
    );
  }

  if (element.type === "math") {
    return <MathShape element={element} editing={editing} onCommit={onCommitMath} />;
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
    <foreignObject data-element-id={element.id} x={element.x} y={element.y} width={element.width} height={element.height} opacity={element.opacity}>
      <InlineText text={element.props.text} color={element.props.color} editing={editing} onCommit={(t) => onCommitText(element.id, t)} />
    </foreignObject>
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

  const d = useMemo(() => (mounted ? strokeToSvgPath(element.props) : ""), [element.props, mounted]);
  const isHighlighter = element.props.variant === "highlighter";

  return (
    <path
      data-element-id={element.id}
      d={d}
      transform={`translate(${element.x},${element.y})`}
      fill={element.props.color}
      opacity={isHighlighter ? element.opacity * 0.4 : element.opacity}
      style={isHighlighter ? { mixBlendMode: "multiply" } : undefined}
    />
  );
}

function MathShape({
  element, editing, onCommit,
}: {
  element: Extract<CanvasElement, { type: "math" }>; editing: boolean;
  onCommit: (id: string, latex: string) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const html = useMemo(
    () => (mounted ? katex.renderToString(element.props.latex || "\\,", { throwOnError: false }) : ""),
    [element.props.latex, mounted],
  );

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

  if (editing) {
    return (
      <foreignObject data-element-id={element.id} x={element.x} y={element.y} width={Math.max(element.width, 140)} height={Math.max(element.height, 40)}>
        {ready ? (
          <math-field
            ref={fieldRef as unknown as React.RefObject<HTMLElement>}
            onBlur={() => onCommit(element.id, fieldRef.current?.value ?? element.props.latex)}
            onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Escape") (e.target as HTMLElement).blur(); }}
            className="block rounded border border-accent bg-surface px-1.5 py-1 text-base"
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
        style={{ color: element.props.color, fontSize: element.props.fontSize }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </foreignObject>
  );
}

function InlineText({
  text, color, editing, onCommit, padded,
}: {
  text: string; color: string; editing: boolean; onCommit: (text: string) => void; padded?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing && ref.current) { ref.current.focus(); autoGrow(ref.current); }
  }, [editing]);

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  if (!editing) {
    return (
      <div className={`h-full w-full whitespace-pre-wrap text-sm ${padded ? "p-2" : "rounded px-1.5 py-1"}`} style={{ color }}>
        {text || <span className="italic text-fg-muted">empty</span>}
      </div>
    );
  }

  return (
    <textarea
      ref={ref}
      defaultValue={text}
      style={{ color }}
      className={`w-full resize-none overflow-hidden border border-accent bg-surface text-sm outline-none ${padded ? "rounded-md p-2" : "rounded px-1.5 py-1"}`}
      onInput={(e) => autoGrow(e.currentTarget)}
      onBlur={(e) => onCommit(e.currentTarget.value)}
      onKeyDown={(e) => { if (e.key === "Escape") e.currentTarget.blur(); }}
    />
  );
}
