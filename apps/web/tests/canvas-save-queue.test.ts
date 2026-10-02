import { describe, expect, it, vi } from "vitest";
import { createSaveSerializer } from "../lib/canvas/saveQueue";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("createSaveSerializer", () => {
  it("fires immediately when nothing is in flight", async () => {
    const performSave = vi.fn(async (n: number) => n);
    const { requestSave } = createSaveSerializer(performSave);
    requestSave(() => 1);
    await Promise.resolve();
    expect(performSave).toHaveBeenCalledTimes(1);
    expect(performSave).toHaveBeenCalledWith(1);
  });

  it("a save requested while one is in flight does not fire immediately", async () => {
    const first = deferred<number>();
    const performSave = vi.fn(async (n: number) => (n === 1 ? first.promise : n));
    const serializer = createSaveSerializer(performSave);

    serializer.requestSave(() => 1);
    await Promise.resolve();
    expect(serializer.isInFlight).toBe(true);

    serializer.requestSave(() => 2);
    // still only the first call has actually reached performSave
    expect(performSave).toHaveBeenCalledTimes(1);

    first.resolve(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(performSave).toHaveBeenCalledTimes(2);
    expect(performSave).toHaveBeenLastCalledWith(2);
  });

  it("collapses a burst of requests during a save into exactly one trailing save, using the freshest args", async () => {
    const first = deferred<number>();
    const performSave = vi.fn(async (n: number) => (n === 1 ? first.promise : n));
    const { requestSave } = createSaveSerializer(performSave);

    requestSave(() => 1);
    await Promise.resolve();
    requestSave(() => 2);
    requestSave(() => 3);
    requestSave(() => 4); // only the last queued factory should matter

    first.resolve(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(performSave).toHaveBeenCalledTimes(2);
    expect(performSave).toHaveBeenLastCalledWith(4);
  });

  it("reads args at run time, not at request time — a queued save sees updated state", async () => {
    const first = deferred<number>();
    const performSave = vi.fn(async (n: number) => (n === 1 ? first.promise : n));
    const { requestSave } = createSaveSerializer(performSave);

    let currentVersion = 1;
    requestSave(() => 1);
    await Promise.resolve();

    currentVersion = 5; // state changes after the queued save was requested
    requestSave(() => currentVersion);

    first.resolve(1);
    await Promise.resolve();
    await Promise.resolve();

    expect(performSave).toHaveBeenLastCalledWith(5);
  });
});
