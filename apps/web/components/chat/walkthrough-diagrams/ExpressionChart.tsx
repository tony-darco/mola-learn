"use client";

import { useMemo } from "react";
import type { z } from "zod";
import type { walkthroughChartSchema } from "@mola/shared";
import { tryEvaluateExpression } from "@/lib/walkthrough/eval";

type Chart = z.infer<typeof walkthroughChartSchema>;

const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 200;
const SAMPLE_COUNT = 60;
const COLOR: Record<"primary" | "secondary", string> = { primary: "var(--accent)", secondary: "var(--muted)" };

/**
 * "static": samples the curve once across [domain start, domain end].
 * "timeseries": a scrolling window ending at the current playback time `t`
 * — the width of that window is just the domain's own span, re-sampled
 * fresh every frame (the expression is a pure function of its independent
 * variable, so no history buffer is needed).
 */
export function ExpressionChart({ chart, paramValues, t }: { chart: Chart; paramValues: Record<string, number>; t: number }) {
  const domainStart = tryEvaluateExpression(chart.domain[0], paramValues) ?? 0;
  const domainEnd = tryEvaluateExpression(chart.domain[1], paramValues) ?? domainStart + 1;
  const span = Math.max(domainEnd - domainStart, 1e-6);

  const windowStart = chart.mode === "timeseries" ? Math.max(domainStart, t - span) : domainStart;
  const windowEnd = chart.mode === "timeseries" ? t : domainEnd;
  const windowSpan = Math.max(windowEnd - windowStart, 1e-6);

  const curves = useMemo(() => {
    return chart.curves.map((curve) => {
      const points: { x: number; y: number }[] = [];
      for (let i = 0; i <= SAMPLE_COUNT; i++) {
        const x = windowStart + (windowSpan * i) / SAMPLE_COUNT;
        const y = tryEvaluateExpression(curve.expression, { ...paramValues, [chart.independentVar]: x });
        if (y != null) points.push({ x, y });
      }
      return { ...curve, points };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart, paramValues, windowStart, windowSpan]);

  const allY = curves.flatMap((c) => c.points.map((p) => p.y));
  const minY = allY.length ? Math.min(...allY) : 0;
  const maxY = allY.length ? Math.max(...allY) : 1;
  const yPad = (maxY - minY) * 0.1 || 1;
  const yLo = minY - yPad;
  const yHi = maxY + yPad;

  function toScreen(x: number, y: number): [number, number] {
    const sx = ((x - windowStart) / windowSpan) * VIEW_WIDTH;
    const sy = VIEW_HEIGHT - ((y - yLo) / (yHi - yLo)) * VIEW_HEIGHT;
    return [sx, sy];
  }

  const markerX = chart.mode === "static" && chart.markerAt != null ? tryEvaluateExpression(chart.markerAt, paramValues) : null;

  return (
    <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} className="h-full w-full" role="img" aria-label="Chart">
      <line x1={0} y1={VIEW_HEIGHT - 0.5} x2={VIEW_WIDTH} y2={VIEW_HEIGHT - 0.5} className="stroke-border" strokeWidth={1} />
      <line x1={0.5} y1={0} x2={0.5} y2={VIEW_HEIGHT} className="stroke-border" strokeWidth={1} />

      {curves.map((curve) => (
        <polyline
          key={curve.label}
          points={curve.points.map((p) => toScreen(p.x, p.y).join(",")).join(" ")}
          fill="none"
          stroke={COLOR[curve.colorRole]}
          strokeWidth={2}
        />
      ))}

      {markerX != null &&
        curves.map((curve) => {
          const y = tryEvaluateExpression(curve.expression, { ...paramValues, [chart.independentVar]: markerX });
          if (y == null) return null;
          const [sx, sy] = toScreen(markerX, y);
          return <circle key={`marker-${curve.label}`} cx={sx} cy={sy} r={3.5} fill={COLOR[curve.colorRole]} />;
        })}

      <text x={4} y={VIEW_HEIGHT - 4} className="fill-fg-muted text-[9px]">
        {chart.independentVar}
      </text>
      {chart.curves.map((curve, i) => (
        <text key={curve.label} x={VIEW_WIDTH - 4} y={12 + i * 12} textAnchor="end" fill={COLOR[curve.colorRole]} className="text-[9px]">
          {curve.label}
        </text>
      ))}
    </svg>
  );
}
