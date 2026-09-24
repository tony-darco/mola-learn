"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import katex from "katex";
import type { z } from "zod";
import type { walkthroughPayloadSchema } from "@mola/shared";
import { Markdown } from "./Markdown";
import { MotionScene } from "./walkthrough-diagrams/MotionScene";
import { ExpressionChart } from "./walkthrough-diagrams/ExpressionChart";
import { tryEvaluateExpression } from "@/lib/walkthrough/eval";

type Payload = z.infer<typeof walkthroughPayloadSchema>;

/**
 * The interactive workspace: numbered step tabs, parameter sliders shared
 * across every step, and — per step — live-computed formulas plus an
 * optional scene (an animated diagram) and/or chart. A step's numbers are
 * never static text; everything re-evaluates from `paramValues` on every
 * slider drag, and a scene/timeseries-chart also re-evaluates every
 * animation frame from the current playback time `t`.
 */
export function WalkthroughView({ payload, title }: { payload: Payload; title: string }) {
  const [paramValues, setParamValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(payload.parameters.map((p) => [p.name, p.default])),
  );
  const [activeStep, setActiveStep] = useState(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number | null>(null);

  const step = payload.steps[activeStep] ?? payload.steps[0]!;
  const duration = step.scene ? tryEvaluateExpression(step.scene.duration, paramValues) ?? 10 : 10;
  const hasTransport = Boolean(step.scene) || step.chart?.mode === "timeseries";

  function selectStep(index: number) {
    const next = payload.steps[index];
    if (!next) return;
    if (!next.continuesFromPreviousStep) {
      setT(0);
      setPlaying(false);
    }
    setActiveStep(index);
  }

  // Playback loop — only runs while `playing`; advances `t` by real elapsed
  // time each frame and loops back to 0 at `duration`.
  useEffect(() => {
    if (!playing) return;
    function frame(now: number) {
      const last = lastFrameRef.current ?? now;
      const dt = (now - last) / 1000;
      lastFrameRef.current = now;
      setT((prev) => (duration > 0 ? (prev + dt) % duration : 0));
      rafRef.current = requestAnimationFrame(frame);
    }
    rafRef.current = requestAnimationFrame(frame);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastFrameRef.current = null;
    };
  }, [playing, duration]);

  return (
    <div>
      <div className="mb-1 text-sm text-fg-muted">{payload.subject}</div>
      <h1 className="mb-4 text-2xl font-semibold text-fg">{title}</h1>

      <div className="mb-5 flex gap-2">
        {payload.steps.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => selectStep(i)}
            aria-label={`Step ${i + 1}: ${s.title}`}
            aria-current={i === activeStep}
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
              i === activeStep ? "bg-accent text-accent-fg" : "border border-border text-fg-muted hover:bg-surface"
            }`}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {payload.parameters.length > 0 && (
        <div className="mb-5 grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
          {payload.parameters.map((p) => (
            <label key={p.name} className="flex flex-col gap-1 text-sm">
              <span className="flex justify-between text-fg">
                <span>{p.label}</span>
                <span className="text-fg-muted">
                  {formatNumber(paramValues[p.name]!)}
                  {p.unit ? ` ${p.unit}` : ""}
                </span>
              </span>
              <input
                type="range"
                min={p.min}
                max={p.max}
                step={p.step}
                value={paramValues[p.name]}
                style={{ accentColor: "var(--accent)" }}
                onChange={(e) => setParamValues((prev) => ({ ...prev, [p.name]: Number(e.target.value) }))}
              />
            </label>
          ))}
        </div>
      )}

      <div className="mb-5">
        <h2 className="mb-2 text-lg font-semibold text-fg">{step.title}</h2>
        <Markdown text={step.body} />
      </div>

      {step.quantities.length > 0 && (
        <div className="mb-5 flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
          {step.quantities.map((q, i) => (
            <QuantityRow key={i} quantity={q} paramValues={paramValues} />
          ))}
        </div>
      )}

      {(step.scene || step.chart) && (
        <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {step.scene && (
            <div className="aspect-square rounded-xl border border-border bg-bg">
              <MotionScene scene={step.scene} paramValues={paramValues} t={t} />
            </div>
          )}
          {step.chart && (
            <div className="aspect-[8/5] rounded-xl border border-border bg-bg">
              <ExpressionChart chart={step.chart} paramValues={paramValues} t={t} />
            </div>
          )}
        </div>
      )}

      {hasTransport && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-fg hover:bg-bg"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? "❚❚" : "▶"}
          </button>
          <input
            type="range"
            min={0}
            max={duration}
            step={duration / 500 || 0.01}
            value={t}
            style={{ accentColor: "var(--accent)" }}
            className="flex-1"
            onChange={(e) => {
              setPlaying(false);
              setT(Number(e.target.value));
            }}
            aria-label="Scrub playback"
          />
          <span className="w-14 shrink-0 text-right text-xs text-fg-muted">{formatNumber(t)}s</span>
        </div>
      )}
    </div>
  );
}

function QuantityRow({ quantity, paramValues }: { quantity: Payload["steps"][number]["quantities"][number]; paramValues: Record<string, number> }) {
  const html = useMemo(
    () => katex.renderToString(quantity.latex, { throwOnError: false, displayMode: false }),
    [quantity.latex],
  );
  const value = tryEvaluateExpression(quantity.expression, paramValues);

  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-fg-muted">{quantity.label}</span>
      <span className="flex items-center gap-2">
        <span dangerouslySetInnerHTML={{ __html: html }} />
        <span className="font-medium text-fg">
          {value == null ? "—" : formatValue(value, quantity.format)}
          {quantity.unit ? ` ${quantity.unit}` : ""}
        </span>
      </span>
    </div>
  );
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function formatValue(value: number, format: string | null): string {
  const match = /^fixed:(\d+)$/.exec(format ?? "");
  if (match) return value.toFixed(Number(match[1]));
  return formatNumber(value);
}
