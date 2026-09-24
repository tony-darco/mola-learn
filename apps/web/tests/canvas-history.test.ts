import { describe, expect, it } from "vitest";
import { emptyHistory, pushHistory, redo, undo } from "../lib/canvas/history";

describe("canvas history", () => {
  it("undo on an empty history returns null", () => {
    expect(undo(emptyHistory<number>(), 1)).toBeNull();
  });

  it("redo on an empty history returns null", () => {
    expect(redo(emptyHistory<number>(), 1)).toBeNull();
  });

  it("undo restores the previous snapshot and clears on a fresh push", () => {
    let h = emptyHistory<number>();
    h = pushHistory(h, 1); // committing state 2, snapshot 1 was "current before"
    const result = undo(h, 2)!;
    expect(result.value).toBe(1);
    expect(result.history.past).toEqual([]);
    expect(result.history.future).toEqual([2]);
  });

  it("redo restores what undo just moved into the future", () => {
    let h = emptyHistory<number>();
    h = pushHistory(h, 1);
    const u = undo(h, 2)!;
    const r = redo(u.history, u.value)!;
    expect(r.value).toBe(2);
    expect(r.history.past).toEqual([1]);
    expect(r.history.future).toEqual([]);
  });

  it("a fresh push after undo clears redo history (no branching timeline)", () => {
    let h = emptyHistory<number>();
    h = pushHistory(h, 1);
    const u = undo(h, 2)!;
    const h2 = pushHistory(u.history, 1); // user made a new edit instead of redoing
    expect(h2.future).toEqual([]);
  });

  it("caps history at 50 entries", () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < 60; i++) h = pushHistory(h, i);
    expect(h.past).toHaveLength(50);
    expect(h.past[0]).toBe(10); // the oldest 10 entries were dropped
  });

  it("multiple undo/redo round-trips preserve order", () => {
    let h = emptyHistory<string>();
    h = pushHistory(h, "a");
    h = pushHistory(h, "b");
    let current = "c";
    const u1 = undo(h, current)!; // -> "b", current="c" now in future
    current = u1.value;
    h = u1.history;
    const u2 = undo(h, current)!; // -> "a"
    current = u2.value;
    h = u2.history;
    expect(current).toBe("a");
    const r1 = redo(h, current)!; // -> "b"
    current = r1.value;
    h = r1.history;
    const r2 = redo(h, current)!; // -> "c"
    current = r2.value;
    expect(current).toBe("c");
  });
});
