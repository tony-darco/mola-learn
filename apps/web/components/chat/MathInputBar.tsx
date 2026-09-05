"use client";

import { useState } from "react";
import { MATH_CATEGORIES } from "./math-symbols";

/**
 * "Math inputs" trigger row, below the composer. Clicking it reveals the
 * five category icons inline to its right; clicking a category doesn't
 * open a popup — it tells the parent composer which category is active, so
 * the composer itself can swap its textarea for a live MathLive field in
 * the exact same box (see MathFieldSurface). One continuous input, not a
 * second box you build in and then explicitly insert from.
 */
export function MathInputBar({
  activeCategory, onSelectCategory, disabled,
}: {
  activeCategory: string | null;
  onSelectCategory: (categoryId: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          onSelectCategory(null);
        }}
        disabled={disabled}
        aria-expanded={open}
        className="whitespace-nowrap rounded-md px-1.5 py-1 text-sm text-fg-muted hover:bg-surface hover:text-fg disabled:cursor-default disabled:opacity-50"
      >
        ∑ Math inputs
      </button>

      {open && (
        <div className="flex items-center gap-0.5">
          {MATH_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              title={cat.label}
              aria-label={cat.label}
              onClick={() => onSelectCategory(activeCategory === cat.id ? null : cat.id)}
              className={`flex h-7 w-7 items-center justify-center rounded-md text-sm ${
                activeCategory === cat.id ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-surface hover:text-fg"
              }`}
            >
              {cat.icon}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
