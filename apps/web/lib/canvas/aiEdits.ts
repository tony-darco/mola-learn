/**
 * The AI's changes as the canvas page applies them: each element the canvas
 * chat streams in (an annotation, lib/canvas/annotate.ts) goes on top of the
 * board as it arrives, and is saved like any other change. A reply's
 * changes are one undo step, however many there are and however long the
 * reply takes — unless the student makes an undo step of their own in
 * between, after which the reply's next change starts another.
 */
import type { CanvasElement } from "@mola/shared";
import { pushHistory, type History } from "./history";
import { recomputeParentIds } from "./membership";
import { nextIndexAfterAll } from "./order";

/** The reply whose changes the newest undo step holds: its assistant message, and the board that step goes back to. */
export type AIStep = { messageId: string; before: CanvasElement[] };

export function applyAIElement(
  state: { elements: CanvasElement[]; history: History<CanvasElement[]>; step: AIStep | null },
  messageId: string,
  element: CanvasElement,
): { elements: CanvasElement[]; history: History<CanvasElement[]>; step: AIStep | null } {
  const { elements } = state;
  if (elements.some((e) => e.id === element.id)) return state;
  const ours = state.step?.messageId === messageId && state.history.past[state.history.past.length - 1] === state.step.before;
  return {
    elements: recomputeParentIds([...elements, { ...element, index: nextIndexAfterAll(elements) }]),
    history: ours ? state.history : pushHistory(state.history, elements),
    step: ours ? state.step : { messageId, before: elements },
  };
}
