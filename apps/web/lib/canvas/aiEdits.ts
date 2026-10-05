/**
 * The AI's changes as the canvas page applies them: the elements the canvas
 * chat streams in (annotations, lib/canvas/annotate.ts) as a reply goes,
 * and those still pending from replies no page took (lib/canvas/chatServer.ts)
 * when the page opens or syncs. Each goes on top of the board and is saved
 * like any other change. A reply's changes are one undo step, however many
 * there are and however long the reply takes — unless the student makes an
 * undo step of their own in between, after which the reply's next change
 * starts another.
 *
 * An edit is applied once per page: one the page has already taken is never
 * added again, even if it comes back pending before the save that
 * acknowledges it — the student may have erased or undone it meanwhile.
 */
import type { CanvasElement } from "@mola/shared";
import { pushHistory, type History } from "./history";
import { recomputeParentIds } from "./membership";
import { nextIndexAfterAll } from "./order";

/** The reply whose changes the newest undo step holds (its key), and the board that step goes back to. */
export type AIStep = { key: string; before: CanvasElement[] };

export type AIEditState = {
  elements: CanvasElement[];
  history: History<CanvasElement[]>;
  step: AIStep | null;
  /** Every AI edit this page has taken, by id. */
  taken: ReadonlySet<string>;
};

/**
 * `incoming`, one reply's (`key`) or all that were pending, added to the
 * board — those the page hasn't taken yet and that aren't on it already.
 * `fresh`: the ids taken now, for the next save to acknowledge.
 */
export function applyAIElements(state: AIEditState, key: string, incoming: CanvasElement[]): AIEditState & { fresh: string[] } {
  const fresh = [...new Map(incoming.filter((e) => !state.taken.has(e.id)).map((e) => [e.id, e])).values()];
  if (fresh.length === 0) return { ...state, fresh: [] };
  const taken = new Set([...state.taken, ...fresh.map((e) => e.id)]);
  const onBoard = new Set(state.elements.map((e) => e.id));
  const added = fresh.filter((e) => !onBoard.has(e.id));
  if (added.length === 0) return { ...state, taken, fresh: fresh.map((e) => e.id) };

  const ours = state.step?.key === key && state.history.past[state.history.past.length - 1] === state.step.before;
  let elements = state.elements;
  for (const e of added) elements = [...elements, { ...e, index: nextIndexAfterAll(elements) }];
  return {
    elements: recomputeParentIds(elements),
    history: ours ? state.history : pushHistory(state.history, state.elements),
    step: ours ? state.step : { key, before: state.elements },
    taken,
    fresh: fresh.map((e) => e.id),
  };
}
