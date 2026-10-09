/**
 * The AI's changes as the canvas page applies them: those the canvas chat
 * streams in as a reply goes — annotations (lib/canvas/annotate.ts), text,
 * math and arrows, and its edits and moves of what is there
 * (lib/canvas/writes.ts) — and those still pending from replies no page took
 * (lib/canvas/chatServer.ts) when the page opens or syncs. What it adds goes
 * on top of the board; what it changes is changed where it is; either is
 * saved like any other change. A reply's changes are one undo step, however
 * many there are and however long the reply takes — unless the student
 * makes an undo step of their own in between, after which the reply's next
 * change starts another.
 *
 * A change is applied once per page: one the page has already taken is
 * never applied again, even if it comes back pending before the save that
 * acknowledges it — the student may have erased or undone it meanwhile. A
 * change to an element no longer on the board is taken, and does nothing.
 */
import type { CanvasElement } from "@mola/shared";
import type { AIChange } from "./chat";
import { pushHistory, type History } from "./history";
import { recomputeParentIds } from "./membership";
import { nextIndexAfterAll } from "./order";

/** The reply whose changes the newest undo step holds (its key), and the board that step goes back to. */
export type AIStep = { key: string; before: CanvasElement[] };

export type AIEditState = {
  elements: CanvasElement[];
  history: History<CanvasElement[]>;
  step: AIStep | null;
  /** Every AI change this page has taken, by id. */
  taken: ReadonlySet<string>;
};

/** What an element keeps whatever is changed: which it is, where it is stacked, and the frame it is in (recomputed from where it is). */
const KEPT = new Set(["id", "type", "index", "parentId"]);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * `element` with what changed from `from` to `to` — each top-level field and
 * each prop that differs between them — and nothing else, so a change made
 * to the board as the model saw it leaves anything since alone. Taking a
 * change back is the same, `to` and `from` swapped.
 */
export function applyChange(element: CanvasElement, from: CanvasElement, to: CanvasElement): CanvasElement {
  const fields = Object.fromEntries(Object.entries(to).filter(([k, v]) => !KEPT.has(k) && k !== "props" && !same(v, from[k as keyof CanvasElement])));
  const props = Object.fromEntries(Object.entries(to.props).filter(([k, v]) => !same(v, (from.props as Record<string, unknown>)[k])));
  return { ...element, ...fields, props: { ...element.props, ...props } } as CanvasElement;
}

/**
 * `incoming`, one reply's (`key`) changes or all that were pending, applied
 * to the board — those the page hasn't taken yet: an element added unless
 * it is on the board already, a change applied to its element if that still
 * is. `fresh`: the ids taken now, for the next save to acknowledge.
 */
export function applyAIChanges(state: AIEditState, key: string, incoming: AIChange[]): AIEditState & { fresh: string[] } {
  const fresh = [...new Map(incoming.filter((c) => !state.taken.has(c.id)).map((c) => [c.id, c])).values()];
  if (fresh.length === 0) return { ...state, fresh: [] };
  const taken = new Set([...state.taken, ...fresh.map((c) => c.id)]);

  let elements = state.elements;
  for (const { element, before } of fresh) {
    const at = elements.findIndex((e) => e.id === element.id);
    if (!before && at < 0) elements = [...elements, { ...element, index: nextIndexAfterAll(elements) }];
    else if (before && at >= 0 && elements[at]!.type === element.type) {
      const changed = applyChange(elements[at]!, before, element);
      if (!same(changed, elements[at])) elements = elements.map((e, i) => (i === at ? changed : e));
    }
  }
  if (elements === state.elements) return { ...state, taken, fresh: fresh.map((c) => c.id) };

  const ours = state.step?.key === key && state.history.past[state.history.past.length - 1] === state.step.before;
  return {
    elements: recomputeParentIds(elements),
    history: ours ? state.history : pushHistory(state.history, state.elements),
    step: ours ? state.step : { key, before: state.elements },
    taken,
    fresh: fresh.map((c) => c.id),
  };
}
