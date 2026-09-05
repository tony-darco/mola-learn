"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { PromptContext } from "./shell-context";

type Pending = { message: string; defaultValue: string; resolve: (value: string | null) => void };

/** Mounted once in AppShell — see PromptContext for why this replaces
 * window.prompt entirely rather than wrapping it. */
export function PromptProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const prompt = useCallback((message: string, defaultValue: string) => {
    return new Promise<string | null>((resolve) => setPending({ message, defaultValue, resolve }));
  }, []);

  useEffect(() => {
    if (pending) {
      setValue(pending.defaultValue);
      const input = inputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
    }
  }, [pending]);

  function respond(result: string | null) {
    pending?.resolve(result);
    setPending(null);
  }

  return (
    <PromptContext.Provider value={prompt}>
      {children}
      {pending && (
        <>
          {/* Invisible — an outside click cancels, but nothing else on the
              page is visually blocked the way a native prompt() would. */}
          <div className="fixed inset-0 z-40" onClick={() => respond(null)} />
          <div className="fixed left-1/2 top-1/2 z-50 flex max-w-sm -translate-x-1/2 -translate-y-1/2 items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-lg">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-fg">{pending.message}</span>
              <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); respond(value); }
                  else if (e.key === "Escape") { e.preventDefault(); respond(null); }
                }}
                className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg"
              />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => respond(null)}
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
                onClick={() => respond(value)}
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
        </>
      )}
    </PromptContext.Provider>
  );
}
