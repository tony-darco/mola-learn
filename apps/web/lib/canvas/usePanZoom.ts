"use client";

import { useEffect, useRef, useState } from "react";
import { select } from "d3-selection";
import "d3-transition"; // augments Selection with `.transition()`, used by zoomBy()
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 2.5;

export type PanZoomOptions = {
  scaleExtent?: [number, number];
  initialTransform?: ZoomTransform;
  /**
   * Wired to d3-zoom's own .filter() — read through a ref updated every
   * render, so callers can react to live state (e.g. the active tool)
   * without the hook tearing down and re-binding the gesture handlers on
   * every change. Defaults to allowing everything, matching d3-zoom's own
   * default (minus our permanent dblclick.zoom disable below) — a plain
   * pan/zoom surface with nothing else happening on it, same as
   * MindMapView's original inline behavior.
   */
  filter?: (event: Event) => boolean;
};

export type PanZoomApi = {
  svgRef: React.RefObject<SVGSVGElement | null>;
  transform: ZoomTransform;
  zoomBy: (factor: number, durationMs?: number) => void;
  /** Imperative reseed — e.g. loading a saved viewport once on mount. */
  setTransform: (t: ZoomTransform, durationMs?: number) => void;
  /** A pointer event's clientX/clientY -> canvas (world) coordinates. */
  toWorld: (clientPoint: { x: number; y: number }) => { x: number; y: number };
};

/**
 * The reusable core of MindMapView's pan/zoom mechanism (transform state,
 * the d3-zoom setup effect, zoomBy), generalized with zero mind-map-specific
 * concerns. MindMapView itself is untouched — this is a fresh extraction,
 * not a refactor of that file.
 */
export function usePanZoom(options?: PanZoomOptions): PanZoomApi {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [transform, setTransformState] = useState<ZoomTransform>(options?.initialTransform ?? zoomIdentity);

  const filterRef = useRef(options?.filter ?? (() => true));
  filterRef.current = options?.filter ?? (() => true);

  const scaleExtent = options?.scaleExtent ?? [ZOOM_MIN, ZOOM_MAX];

  useEffect(() => {
    if (!svgRef.current) return;
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent(scaleExtent)
      .filter((event) => filterRef.current(event))
      .on("zoom", (event) => setTransformState(event.transform));

    const selection = select(svgRef.current);
    selection.call(behavior);
    // A canvas surface has its own text-editing double-click (opening a text
    // note); d3-zoom's default double-click-to-zoom would fight that. This
    // removes the listener the zoom behavior just attached to the selection
    // under this namespace — it's a selection-level override, not a
    // behavior-level one (behavior.on() only dispatches "start"/"zoom"/"end").
    selection.on("dblclick.zoom", null);
    if (options?.initialTransform) selection.call(behavior.transform, options.initialTransform);
    zoomBehaviorRef.current = behavior;

    return () => {
      select(svgRef.current!).on(".zoom", null);
      zoomBehaviorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scaleExtent/initialTransform are read once at setup, matching MindMapView's original one-time-setup effect.
  }, []);

  function zoomBy(factor: number, durationMs = 200) {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    select(svgRef.current).transition().duration(durationMs).call(zoomBehaviorRef.current.scaleBy, factor);
  }

  function setTransform(t: ZoomTransform, durationMs = 0) {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    const selection = select(svgRef.current);
    if (durationMs > 0) selection.transition().duration(durationMs).call(zoomBehaviorRef.current.transform, t);
    else selection.call(zoomBehaviorRef.current.transform, t);
  }

  function toWorld(clientPoint: { x: number; y: number }): { x: number; y: number } {
    if (!svgRef.current) return clientPoint;
    const rect = svgRef.current.getBoundingClientRect();
    const [x, y] = transform.invert([clientPoint.x - rect.left, clientPoint.y - rect.top]);
    return { x, y };
  }

  return { svgRef, transform, zoomBy, setTransform, toWorld };
}
