"use client";

import { useId } from "react";
import type { z } from "zod";
import { canvasPayloadSchema, type CanvasElement } from "@mola/shared";
import { strokeToPolylinePath, strokeToSvgPath } from "@/lib/canvas/strokePath";

type CanvasPayload = z.infer<typeof canvasPayloadSchema>;
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function elementBounds(element: CanvasElement): Bounds {
  if (element.type === "line") {
    return {
      minX: Math.min(element.x, element.x + element.props.endX),
      minY: Math.min(element.y, element.y + element.props.endY),
      maxX: Math.max(element.x, element.x + element.props.endX),
      maxY: Math.max(element.y, element.y + element.props.endY),
    };
  }
  return {
    minX: element.x,
    minY: element.y,
    maxX: element.x + element.width,
    maxY: element.y + element.height,
  };
}

function dashArray(dash: "solid" | "dashed" | "dotted", width: number): string | undefined {
  if (dash === "dashed") return `${width * 3} ${width * 2}`;
  if (dash === "dotted") return `0.1 ${width * 2}`;
  return undefined;
}

function ArrowHead({ tipX, tipY, fromX, fromY, size, color }: {
  tipX: number; tipY: number; fromX: number; fromY: number; size: number; color: string;
}) {
  const angle = Math.atan2(tipY - fromY, tipX - fromX);
  const left = angle + Math.PI - Math.PI / 6;
  const right = angle + Math.PI + Math.PI / 6;
  return (
    <polygon
      points={`${tipX},${tipY} ${tipX + size * Math.cos(left)},${tipY + size * Math.sin(left)} ${tipX + size * Math.cos(right)},${tipY + size * Math.sin(right)}`}
      fill={color}
    />
  );
}

function ThumbnailElement({ element }: { element: CanvasElement }) {
  if (element.type === "draw") {
    const { points, color, strokeWidth, variant, dash } = element.props;
    return (
      <g transform={`translate(${element.x} ${element.y})`} opacity={element.opacity}>
        {dash === "solid" ? (
          <path d={strokeToSvgPath(element.props)} fill={color} opacity={variant === "highlighter" ? 0.4 : 1} />
        ) : (
          <path
            d={strokeToPolylinePath(points)} fill="none" stroke={color} strokeWidth={strokeWidth}
            strokeDasharray={dashArray(dash, strokeWidth)} strokeLinecap="round" strokeLinejoin="round"
            opacity={variant === "highlighter" ? 0.4 : 1}
          />
        )}
      </g>
    );
  }

  if (element.type === "line") {
    const { endX, endY, color, strokeWidth, dash, startArrow, endArrow } = element.props;
    const x2 = element.x + endX;
    const y2 = element.y + endY;
    const headSize = Math.max(strokeWidth * 4, 12);
    return (
      <g opacity={element.opacity}>
        <line
          x1={element.x} y1={element.y} x2={x2} y2={y2} stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={dashArray(dash, strokeWidth)} strokeLinecap="round"
        />
        {startArrow && <ArrowHead tipX={element.x} tipY={element.y} fromX={x2} fromY={y2} size={headSize} color={color} />}
        {endArrow && <ArrowHead tipX={x2} tipY={y2} fromX={element.x} fromY={element.y} size={headSize} color={color} />}
      </g>
    );
  }

  if (element.type === "shape") {
    const { x, y, width, height } = element;
    const { shapeKind, color, fillColor, fillStyle, strokeWidth, dash } = element.props;
    const fill = fillStyle === "none" ? "none" : fillColor ?? color;
    const common = { fill, stroke: color, strokeWidth, strokeDasharray: dashArray(dash, strokeWidth), opacity: element.opacity };
    if (shapeKind === "ellipse") return <ellipse cx={x + width / 2} cy={y + height / 2} rx={width / 2} ry={height / 2} {...common} />;
    if (shapeKind === "triangle") return <polygon points={`${x + width / 2},${y} ${x},${y + height} ${x + width},${y + height}`} {...common} />;
    if (shapeKind === "star") {
      const points = Array.from({ length: 10 }, (_, index) => {
        const radius = Math.min(width, height) * (index % 2 === 0 ? 0.5 : 1 / 4.5);
        const angle = (Math.PI / 5) * index - Math.PI / 2;
        return `${x + width / 2 + radius * Math.cos(angle)},${y + height / 2 + radius * Math.sin(angle)}`;
      }).join(" ");
      return <polygon points={points} {...common} />;
    }
    return <rect x={x} y={y} width={width} height={height} {...common} />;
  }

  if (element.type === "image") {
    return <image href={element.props.url} x={element.x} y={element.y} width={element.width} height={element.height} opacity={element.opacity} preserveAspectRatio="xMidYMid slice" />;
  }

  if (element.type === "frame") {
    return (
      <g opacity={element.opacity}>
        <rect x={element.x} y={element.y} width={element.width} height={element.height} fill="none" stroke="#78716c" strokeDasharray="7 5" />
        <text x={element.x + 6} y={element.y + element.height + 14} fill="#78716c" fontSize={12}>{element.props.name}</text>
      </g>
    );
  }

  // AI annotations are an overlay on the board, not its content.
  if (element.type === "annotation") return null;

  const isNote = element.type === "note";
  const { x, y, width, height } = element;
  const text = element.type === "math" ? element.props.latex : element.props.text;
  const fontSize = element.props.fontSize;
  const ink = isNote ? element.props.textColor : element.props.color;
  const paper = isNote ? element.props.color : element.type === "text" ? element.props.backgroundColor : null;
  const bold = isNote || element.type === "text" ? element.props.bold : false;
  const italic = isNote || element.type === "text" ? element.props.italic : false;
  const textAlign = isNote || element.type === "text" ? element.props.textAlign : "left";
  const padding = isNote ? 8 : 0;
  const textX = textAlign === "center" ? x + width / 2 : textAlign === "right" ? x + width - padding : x + padding;
  const anchor = textAlign === "center" ? "middle" : textAlign === "right" ? "end" : "start";
  const lines = text.split("\n");
  return (
    <g opacity={element.opacity}>
      {(isNote || paper) && <rect x={x} y={y} width={width} height={height} fill={paper ?? "#fde68a"} />}
      <text
        x={textX} y={y + padding + fontSize} fill={ink} fontSize={fontSize} textAnchor={anchor}
        fontWeight={bold ? 700 : 400} fontStyle={italic ? "italic" : "normal"}
      >
        {lines.map((line, index) => <tspan key={index} x={textX} dy={index === 0 ? 0 : fontSize * 1.25}>{line}</tspan>)}
      </text>
    </g>
  );
}

export function CanvasThumbnail({ payload }: { payload: CanvasPayload }) {
  const patternId = `canvas-thumb-${useId().replaceAll(":", "")}`;
  const elements = [...payload.elements].sort((a, b) => a.index < b.index ? -1 : a.index > b.index ? 1 : 0);
  const bounds = elements.map(elementBounds);
  const minX = bounds.length ? Math.min(...bounds.map((b) => b.minX)) : -100;
  const minY = bounds.length ? Math.min(...bounds.map((b) => b.minY)) : -60;
  const maxX = bounds.length ? Math.max(...bounds.map((b) => b.maxX)) : 100;
  const maxY = bounds.length ? Math.max(...bounds.map((b) => b.maxY)) : 60;
  const contentWidth = Math.max(maxX - minX, 1);
  const contentHeight = Math.max(maxY - minY, 1);
  const padding = Math.max(contentWidth, contentHeight) * 0.06;
  const patternStroke = "#a8a29e";

  return (
    <svg
      viewBox={`${minX - padding} ${minY - padding} ${contentWidth + padding * 2} ${contentHeight + padding * 2}`}
      preserveAspectRatio="xMidYMid meet" role="img" aria-label="Canvas thumbnail"
      className="block h-28 w-full"
    >
      <rect x={minX - padding} y={minY - padding} width={contentWidth + padding * 2} height={contentHeight + padding * 2} fill={payload.background.color} />
      {payload.background.pattern !== "blank" && (
        <defs>
          <pattern id={patternId} width={24} height={24} patternUnits="userSpaceOnUse">
            {payload.background.pattern === "dots" && <circle cx={2} cy={2} r={1.2} fill={patternStroke} />}
            {payload.background.pattern === "grid" && <path d="M 24 0 L 0 0 0 24" fill="none" stroke={patternStroke} strokeWidth={1} />}
            {payload.background.pattern === "lines" && <line x1={0} y1={24} x2={24} y2={24} stroke={patternStroke} strokeWidth={1} />}
          </pattern>
        </defs>
      )}
      {payload.background.pattern !== "blank" && (
        <rect x={minX - padding} y={minY - padding} width={contentWidth + padding * 2} height={contentHeight + padding * 2} fill={`url(#${patternId})`} />
      )}
      {elements.map((element) => <ThumbnailElement key={element.id} element={element} />)}
    </svg>
  );
}