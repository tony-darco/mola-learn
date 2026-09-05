"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { MathfieldElement } from "mathlive";
import { buildMatrixLatex, type MathCategory, type MathSnippet } from "./math-symbols";

/**
 * Replaces the composer's plain textarea, in the exact same bordered box,
 * while a math category is active — a live MathLive field with real visual
 * structure (a fraction renders as two stacked boxes with a bar between
 * them, a root as an actual radical), not raw LaTeX text and not a second
 * floating box elsewhere. Pressing Enter (or the confirm control) commits
 * the built expression back as LaTeX and hands control back to the plain
 * textarea in the same spot; Escape/cancel backs out with nothing inserted.
 */
export function MathFieldSurface({
  category, onDone, onCancel,
}: {
  category: MathCategory;
  onDone: (latex: string) => void;
  onCancel: () => void;
}) {
  const [ready, setReady] = useState(false);
  const mathFieldRef = useRef<MathfieldElement | null>(null);
  const [sizePrompt, setSizePrompt] = useState<{ rows: string; cols: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("mathlive").then(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const el = mathFieldRef.current;
    el?.focus();

    // MathLive owns Enter internally (row/array navigation) and never lets
    // a plain keydown listener on the host element see it — confirmed live,
    // this handler never fired for Enter, so the icon buttons are the only
    // way to confirm/cancel. Escape isn't a MathLive-reserved editing key,
    // so it still reaches a normal keydown listener.
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    };
    el?.addEventListener("keydown", onKeydown);
    return () => {
      el?.removeEventListener("keydown", onKeydown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  function clampDimension(raw: string): number {
    const n = Math.round(Number(raw));
    return Number.isFinite(n) ? Math.max(1, Math.min(20, n)) : 1;
  }

  function insertSnippet(snippet: MathSnippet) {
    if (snippet.dynamic === "matrix") {
      setSizePrompt({ rows: "2", cols: "2" });
      return;
    }

    mathFieldRef.current?.insert(snippet.latex, {
      selectionMode: snippet.hasBlank ? "placeholder" : "after",
    });
    mathFieldRef.current?.focus();
  }

  function confirmSize() {
    if (!sizePrompt) return;
    const rows = clampDimension(sizePrompt.rows);
    const cols = clampDimension(sizePrompt.cols);
    setSizePrompt(null);
    mathFieldRef.current?.insert(buildMatrixLatex(rows, cols), { selectionMode: "placeholder" });
    mathFieldRef.current?.focus();
  }

  function done() {
    const raw = mathFieldRef.current?.value.trim() ?? "";
    // An unfilled \placeholder{} stays literally in the LaTeX output —
    // KaTeX doesn't know that command, so strip it down to a plain empty
    // group (harmless: \sqrt{} already renders fine on its own).
    onDone(raw.replace(/\\placeholder\{\}/g, ""));
  }

  return (
    <div className="flex flex-1 flex-col gap-2">
      {/* One combined n×m step, not two sequential prompts — and anchored to
          the composer itself (the nearest `relative` ancestor is the
          composer's own bordered box), not centered on the viewport or in a
          corner, so it sits right above the composer in the same spot the
          hint/model row already occupies. */}
      {sizePrompt && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setSizePrompt(null)} />
          <div className="absolute bottom-full left-0 z-50 mb-1 flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 shadow-lg">
            <input
              type="number"
              min={1}
              max={20}
              value={sizePrompt.rows}
              autoFocus
              onChange={(e) => setSizePrompt((p) => (p ? { ...p, rows: e.target.value } : p))}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); confirmSize(); }
                else if (e.key === "Escape") { e.preventDefault(); setSizePrompt(null); }
              }}
              className="w-14 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg"
            />
            <span className="text-sm text-fg-muted">×</span>
            <input
              type="number"
              min={1}
              max={20}
              value={sizePrompt.cols}
              onChange={(e) => setSizePrompt((p) => (p ? { ...p, cols: e.target.value } : p))}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); confirmSize(); }
                else if (e.key === "Escape") { e.preventDefault(); setSizePrompt(null); }
              }}
              className="w-14 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg"
            />
            <button
              type="button"
              onClick={() => setSizePrompt(null)}
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
              onClick={confirmSize}
              title="Insert"
              aria-label="Insert"
              className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-fg hover:opacity-90"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </div>
        </>
      )}

      <div className="grid grid-cols-8 gap-0.5">
        {category.snippets.map((s) => (
          <button
            key={s.label}
            type="button"
            title={s.label}
            onClick={() => insertSnippet(s)}
            className="rounded-md px-1 py-1 text-sm text-fg hover:bg-bg"
          >
            {s.label}
          </button>
        ))}
      </div>

      {ready ? (
        <math-field
          ref={mathFieldRef as unknown as RefObject<HTMLElement>}
          className="block w-full rounded-md border border-border bg-bg px-2 py-1.5 text-base"
        />
      ) : (
        <div className="flex h-10 items-center justify-center rounded-md border border-border bg-bg text-sm text-fg-muted">
          Loading…
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-sm text-fg-muted">{category.label} — Esc to cancel</span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCancel}
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
            onClick={done}
            title="Insert"
            aria-label="Insert"
            className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-fg hover:opacity-90"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
