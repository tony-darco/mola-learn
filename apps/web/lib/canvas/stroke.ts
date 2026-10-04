export type DraftPoint = { x: number; y: number; pressure?: number };
export type FinalizedStroke = {
  x: number; y: number; width: number; height: number;
  points: DraftPoint[];
};

/** 2 decimal places — see artifacts.ts's canvas payload-size note. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Computes the stroke's bounding box and relativizes/rounds every point to
 * it, so moving the finished element is a plain x/y mutation (§5 of the
 * canvas plan) rather than rewriting the whole points array. Returns null
 * for a stray tap (fewer than 2 points) — the caller discards it.
 */
export function finalizeStroke(points: DraftPoint[]): FinalizedStroke | null {
  if (points.length < 2) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const relativePoints = points.map((p) => ({
    x: round(p.x - minX),
    y: round(p.y - minY),
    ...(p.pressure !== undefined ? { pressure: p.pressure } : {}),
  }));

  return {
    x: round(minX), y: round(minY),
    width: round(maxX - minX), height: round(maxY - minY),
    points: relativePoints,
  };
}
