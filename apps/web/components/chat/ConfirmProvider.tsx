"use client";

import { useCallback, useState, type ReactNode } from "react";
import { ConfirmContext } from "./shell-context";

type Pending = { message: string; resolve: (value: boolean) => void };

/** Mounted once in AppShell — see ConfirmContext for why this replaces
 * window.confirm entirely rather than wrapping it. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback((message: string) => {
    return new Promise<boolean>((resolve) => setPending({ message, resolve }));
  }, []);

  function respond(value: boolean) {
    pending?.resolve(value);
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => respond(false)}
        >
          <div
            className="flex max-w-sm items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-sm text-fg">{pending.message}</span>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => respond(false)}
                title="Cancel"
                aria-label="Cancel"
                className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-bg hover:text-fg"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => respond(true)}
                title="Confirm"
                aria-label="Confirm"
                className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-fg hover:opacity-90"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
