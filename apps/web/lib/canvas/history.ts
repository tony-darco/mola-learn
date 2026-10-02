/** Snapshot-based undo/redo — one entry per committed gesture (stroke, drag, delete, ...), never per pointermove. */
export type History<T> = { past: T[]; future: T[] };

const MAX_HISTORY = 50;

export function emptyHistory<T>(): History<T> {
  return { past: [], future: [] };
}

export function pushHistory<T>(history: History<T>, previous: T): History<T> {
  const past = [...history.past, previous].slice(-MAX_HISTORY);
  return { past, future: [] };
}

export function undo<T>(history: History<T>, current: T): { history: History<T>; value: T } | null {
  if (history.past.length === 0) return null;
  const value = history.past[history.past.length - 1]!;
  const past = history.past.slice(0, -1);
  return { history: { past, future: [current, ...history.future] }, value };
}

export function redo<T>(history: History<T>, current: T): { history: History<T>; value: T } | null {
  if (history.future.length === 0) return null;
  const value = history.future[0]!;
  const future = history.future.slice(1);
  return { history: { past: [...history.past, current], future }, value };
}
