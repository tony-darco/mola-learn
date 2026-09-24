"use client";

import { useMemo } from "react";
import type { z } from "zod";
import type { walkthroughSceneSchema } from "@mola/shared";
import { tryEvaluateExpression } from "@/lib/walkthrough/eval";

type Scene = z.infer<typeof walkthroughSceneSchema>;
type Body = Scene["bodies"][number];

const VIEW_SIZE = 320;
const PADDING_FRACTION = 0.18;
const BOUNDS_SAMPLES = 40;
const TRAIL_SAMPLES = 24;

/**
 * The one general diagram renderer — genuinely topic-agnostic. It has no
 * idea whether "scene" describes an orbit, a collision, or anything else;
 * it just draws circles (bodies) whose position is a function of time, and
 * straight lines (trails, vectors, a scale bar). No per-topic component.
 */
export function MotionScene({ scene, paramValues, t }: { scene: Scene; paramValues: Record<string, number>; t: number }) {
  const durationSeconds = tryEvaluateExpression(scene.duration, paramValues) ?? 10;

  // Sample every body's full trajectory once (not per-frame) to get a
  // stable world-to-screen mapping — the scene fits whatever world-unit
  // scale the model chose without re-zooming/jittering as t advances.
  const bounds = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxVectorMag = 0;
    for (let i = 0; i <= BOUNDS_SAMPLES; i++) {
      const sampleT = (durationSeconds * i) / BOUNDS_SAMPLES;
      const scope = { ...paramValues, t: sampleT };
      for (const body of scene.bodies) {
        const x = tryEvaluateExpression(body.x, scope);
        const y = tryEvaluateExpression(body.y, scope);
        const r = tryEvaluateExpression(body.radius, paramValues) ?? 0;
        if (x == null || y == null) continue;
        minX = Math.min(minX, x - r);
        maxX = Math.max(maxX, x + r);
        minY = Math.min(minY, y - r);
        maxY = Math.max(maxY, y + r);
      }
      for (const vec of scene.vectors) {
        const dx = tryEvaluateExpression(vec.dx, scope);
        const dy = tryEvaluateExpression(vec.dy, scope);
        if (dx == null || dy == null) continue;
        maxVectorMag = Math.max(maxVectorMag, Math.hypot(dx, dy));
      }
    }
    if (!Number.isFinite(minX)) return { minX: -1, maxX: 1, minY: -1, maxY: 1, maxVectorMag: 0 };
    return { minX, maxX, minY, maxY, maxVectorMag };
    // scene/paramValues change identity every render from WalkthroughView's
    // memoized paramValues object, which is exactly the "recompute" trigger we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, paramValues, durationSeconds]);

  const worldWidth = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const worldHeight = Math.max(bounds.maxY - bounds.minY, 1e-6);
  const worldSize = Math.max(worldWidth, worldHeight) * (1 + PADDING_FRACTION * 2);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const scale = VIEW_SIZE / worldSize;
  const vectorScale = bounds.maxVectorMag > 0 ? (worldSize * 0.15) / bounds.maxVectorMag : 0;

  function toScreen(x: number, y: number): [number, number] {
    // SVG y grows downward — flip so "up" in world space stays up on screen.
    return [VIEW_SIZE / 2 + (x - centerX) * scale, VIEW_SIZE / 2 - (y - centerY) * scale];
  }

  function trailPoints(body: Body): string {
    const points: string[] = [];
    for (let i = 0; i <= TRAIL_SAMPLES; i++) {
      const sampleT = durationSeconds > 0 ? (t * i) / TRAIL_SAMPLES : 0;
      const x = tryEvaluateExpression(body.x, { ...paramValues, t: sampleT });
      const y = tryEvaluateExpression(body.y, { ...paramValues, t: sampleT });
      if (x == null || y == null) continue;
      points.push(toScreen(x, y).join(","));
    }
    return points.join(" ");
  }

  const scope = { ...paramValues, t };

  return (
    <svg viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`} className="h-full w-full" role="img" aria-label="Interactive diagram">
      {scene.bodies.map((body) => {
        const x = tryEvaluateExpression(body.x, scope);
        const y = tryEvaluateExpression(body.y, scope);
        const r = tryEvaluateExpression(body.radius, paramValues) ?? 4;
        if (x == null || y == null) return null;
        const [sx, sy] = toScreen(x, y);
        const screenR = Math.max(r * scale, 3);
        return (
          <g key={body.id}>
            {body.trail && (
              <polyline points={trailPoints(body)} fill="none" className="stroke-accent" strokeWidth={1.5} opacity={0.35} />
            )}
            <circle cx={sx} cy={sy} r={screenR} className="fill-accent" />
            {body.label && (
              <text x={sx} y={sy - screenR - 6} textAnchor="middle" className="fill-fg text-[10px]">
                {body.label}
              </text>
            )}
          </g>
        );
      })}

      {scene.vectors.map((vec, i) => {
        const from = scene.bodies.find((b) => b.id === vec.fromBodyId);
        if (!from) return null;
        const x = tryEvaluateExpression(from.x, scope);
        const y = tryEvaluateExpression(from.y, scope);
        const dx = tryEvaluateExpression(vec.dx, scope);
        const dy = tryEvaluateExpression(vec.dy, scope);
        if (x == null || y == null || dx == null || dy == null) return null;
        const [x1, y1] = toScreen(x, y);
        const [x2, y2] = toScreen(x + (dx * vectorScale) / scale, y + (dy * vectorScale) / scale);
        return <ArrowLine key={i} x1={x1} y1={y1} x2={x2} y2={y2} label={vec.label} />;
      })}

      {scene.scaleBar && (
        <ScaleBar lengthWorldUnits={tryEvaluateExpression(scene.scaleBar.lengthWorldUnits, paramValues)} scale={scale} label={scene.scaleBar.label} />
      )}
    </svg>
  );
}

function ArrowLine({ x1, y1, x2, y2, label }: { x1: number; y1: number; x2: number; y2: number; label: string | null }) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = 6;
  const hx1 = x2 - headLen * Math.cos(angle - Math.PI / 6);
  const hy1 = y2 - headLen * Math.sin(angle - Math.PI / 6);
  const hx2 = x2 - headLen * Math.cos(angle + Math.PI / 6);
  const hy2 = y2 - headLen * Math.sin(angle + Math.PI / 6);
  return (
    <g>
      <line x1={x1} y1={y1} x2={x2} y2={y2} className="stroke-fg" strokeWidth={1.5} />
      <polygon points={`${x2},${y2} ${hx1},${hy1} ${hx2},${hy2}`} className="fill-fg" />
      {label && (
        <text x={x2 + 4} y={y2 - 4} className="fill-fg text-[10px]">
          {label}
        </text>
      )}
    </g>
  );
}

function ScaleBar({ lengthWorldUnits, scale, label }: { lengthWorldUnits: number | null; scale: number; label: string }) {
  if (lengthWorldUnits == null) return null;
  const lengthScreen = lengthWorldUnits * scale;
  const barY = VIEW_SIZE - 16;
  return (
    <g>
      <line x1={16} y1={barY} x2={16 + lengthScreen} y2={barY} className="stroke-fg-muted" strokeWidth={2} />
      <text x={16} y={barY - 6} className="fill-fg-muted text-[10px]">
        {label}
      </text>
    </g>
  );
}
