import type { CanvasElement } from "@mola/shared";

function center(el: CanvasElement): { x: number; y: number } {
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

function containsPoint(frame: CanvasElement, point: { x: number; y: number }): boolean {
  return (
    point.x >= frame.x && point.x <= frame.x + frame.width &&
    point.y >= frame.y && point.y <= frame.y + frame.height
  );
}

/**
 * Recomputes every non-frame element's parentId against current frame
 * bounds — called after a frame is created, after a frame is moved, and
 * after any element's own move (see CanvasView §5: this is what keeps
 * membership honest instead of going stale when a frame moves away from
 * content it used to contain, or is drawn around content that already
 * existed). Topmost frame (highest index) wins when bounds overlap. Frames
 * are never reparented into other frames in this phase.
 */
export function recomputeParentIds(elements: CanvasElement[]): CanvasElement[] {
  const frames = elements.filter((e) => e.type === "frame");
  return elements.map((e) => {
    if (e.type === "frame") return e;
    const c = center(e);
    let best: CanvasElement | null = null;
    for (const f of frames) {
      if (containsPoint(f, c) && (best === null || f.index > best.index)) best = f;
    }
    const parentId = best?.id ?? null;
    return e.parentId === parentId ? e : { ...e, parentId };
  });
}

/**
 * Removes an element. Deleting a frame nulls parentId on its former
 * children rather than deleting them — the frame is just a label on a
 * region, not an owner of what's in it.
 */
export function deleteElement(elements: CanvasElement[], id: string): CanvasElement[] {
  const target = elements.find((e) => e.id === id);
  if (!target) return elements;
  const withoutTarget = elements.filter((e) => e.id !== id);
  if (target.type !== "frame") return withoutTarget;
  return withoutTarget.map((e) => (e.parentId === id ? { ...e, parentId: null } : e));
}
