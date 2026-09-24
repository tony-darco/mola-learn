/**
 * Only one save in flight at a time. A save requested while one is already
 * running doesn't fire immediately — it's recorded as pending and fires
 * exactly once, with freshly-computed args, after the in-flight one
 * resolves. This is what stops a burst of mutations during a save from
 * producing a false conflict: without it, a second save fired mid-flight
 * would carry the same `expectedVersion` the first one did (the caller's
 * "last confirmed version" hasn't moved yet), so it would fail its own CAS
 * check against the first save's own eventual write — a conflict banner in
 * a single tab, from a single user, with no other writer involved.
 *
 * `argsFactory` is a function, not a value, specifically so a queued save
 * reads current state (paramValues, the just-updated version) at the moment
 * it actually runs, not at the moment it was requested.
 */
export function createSaveSerializer<Args, Result>(performSave: (args: Args) => Promise<Result>) {
  let inFlight = false;
  let pendingArgsFactory: (() => Args) | null = null;

  async function run(args: Args): Promise<Result> {
    inFlight = true;
    try {
      return await performSave(args);
    } finally {
      inFlight = false;
      if (pendingArgsFactory) {
        const factory = pendingArgsFactory;
        pendingArgsFactory = null;
        void run(factory());
      }
    }
  }

  function requestSave(argsFactory: () => Args): void {
    if (inFlight) {
      pendingArgsFactory = argsFactory;
      return;
    }
    void run(argsFactory());
  }

  return {
    requestSave,
    get isInFlight() {
      return inFlight;
    },
  };
}
