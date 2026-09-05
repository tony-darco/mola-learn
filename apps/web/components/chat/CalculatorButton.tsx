"use client";

import { useCalculator } from "./shell-context";

/** Toggles the floating calculator widget (§ calculator feature) — sits next
 * to Math inputs in both composers; the widget itself is global (mounted
 * once in AppShell), so every instance of this button toggles the same one. */
export function CalculatorButton() {
  const { open, toggle } = useCalculator();
  return (
    <button
      type="button"
      onClick={toggle}
      title="Calculator"
      aria-label="Calculator"
      aria-pressed={open}
      className={`flex h-7 w-7 items-center justify-center rounded-md ${
        open ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-surface hover:text-fg"
      }`}
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <line x1="8" y1="7" x2="16" y2="7" />
        <line x1="8" y1="11" x2="8" y2="11" />
        <line x1="12" y1="11" x2="12" y2="11" />
        <line x1="16" y1="11" x2="16" y2="11" />
        <line x1="8" y1="15" x2="8" y2="15" />
        <line x1="12" y1="15" x2="12" y2="15" />
        <line x1="16" y1="15" x2="16" y2="15" />
        <line x1="8" y1="19" x2="8" y2="19" />
        <line x1="12" y1="19" x2="12" y2="19" />
        <line x1="16" y1="19" x2="16" y2="19" />
      </svg>
    </button>
  );
}
